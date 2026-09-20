const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {openGame} = require('./browser-harness.cjs');

test('premium polish: energy, DOM reuse, sharing and responsive artwork', async t => {
  const g=await openGame(),{page,run}=g;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(()=>g.close());
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  const advance=ms=>page.clock.runFor(ms);
  const start=()=>run("startGame({opponentType:'bot',format:'turns'});stopTimers();$('devTools').hidden=true;");

  await t.test('each cascade beam accumulates locally and the total merges only once the play ends',async()=>{
    await start();
    await run("window.r=createCascadeRewards();state.playerScore=30;collectCascadeFeedback('player',r,30,0,rewardOrigin([{r:2,c:3}]));flushCascadeFeedback('player',r);renderHud();");
    await advance(280);
    assert.equal(await page.locator('.energy-flight.score').count(),1);
    assert.equal(await page.locator('.energy-flight.score').textContent(),'','no number flies');
    assert.equal(await page.locator('.energy-flight.score i').count(),7);
    assert.equal(await page.locator('#playerScore').textContent(),'0');
    await advance(320);
    assert.equal(await page.locator('#playerScoreReward').textContent(),'+30');
    for(const [delta,total] of [[40,70],[50,120]]) {
      await run(`state.playerScore+=${delta};collectCascadeFeedback('player',r,${delta},0,rewardOrigin([{r:5,c:4}]));flushCascadeFeedback('player',r);renderHud();`);
      await advance(600);
      assert.equal(await page.locator('#playerScoreReward').textContent(),`+${total}`);
      assert.equal(await page.locator('#playerScore').textContent(),'0');
    }
    await run("r.moves=2;addBonusMoney('player',6);collectCascadeFeedback('player',r,0,6);flushCascadeFeedback('player',r);renderHud();");
    await advance(700);
    assert.equal(await page.locator('#playerMovesReward').textContent(),'+2 MOV.');
    assert.equal(await page.locator('#playerMoves').textContent(),'3 MOV.','unapplied movement reward does not reduce the HUD');
    assert.equal(await page.locator('#playerMoneyReward').textContent(),'+R$ 6,00');
    await run("finalizeCascadeRewards('player',r);");
    await advance(100);
    assert.equal(await page.locator('#playerScore').textContent(),'0');
    await advance(160);
    const counting=Number(await page.locator('#playerScore').textContent());
    assert.ok(counting>0 && counting<120);
    await advance(600);
    assert.equal(await page.locator('#playerScore').textContent(),'120');
    assert.equal(await page.locator('#playerMoves').textContent(),'5 MOV.');
    assert.equal(await page.locator('#playerMoney').textContent(),'R$ 7,20');
    assert.deepEqual(await run('[hudHolds.size,energyBatches.size,energyFlights.size,energyFrame]'),[0,0,0,null]);
    assert.equal(await page.locator('#playerScoreReward').textContent(),'');
  });

  await t.test('overlapping plays and restart do not mix reservations',async()=>{
    await start();
    await run("state.playerScore=30;showPlayFeedback('player',{points:30});renderHud();");
    await advance(600);
    await run("state.playerScore=100;showPlayFeedback('player',{points:70});renderHud();");
    await advance(550);
    assert.equal(await page.locator('#playerScore').textContent(),'30');
    await advance(900);
    assert.equal(await page.locator('#playerScore').textContent(),'100');
    await run("state.playerScore+=60;showPlayFeedback('player',{points:60});");
    await advance(100);await start();await advance(1600);
    assert.equal(await page.locator('#playerScore').textContent(),'0');
    assert.deepEqual(await run('[hudHolds.size,energyBatches.size,energyFlights.size]'),[0,0,0]);
  });

  await t.test('unchanged HUD/board has no DOM churn; selection reuses gem identities',async()=>{
    await start();await run("renderBoard('player');");
    const result=await run(`(()=>{const nodes=[...$('board').children];const o=new MutationObserver(()=>{});o.observe($('gameScreen'),{subtree:true,childList:true,attributes:true,characterData:true});for(let i=0;i<20;i++){renderHud();renderBoard('player');}const mutations=o.takeRecords().length;o.disconnect();selected.player={r:3,c:2};renderBoard('player');return {mutations,reused:nodes.every((n,i)=>n===$('board').children[i]),selected:$('board').querySelectorAll('.selected').length};})()`);
    assert.deepEqual(result,{mutations:0,reused:true,selected:1});
    assert.equal(await page.locator('#board .jewel-face svg').count(),64);
    await run("state.board[2][2].special='prism';renderBoard('player');renderBoard('player');");
    assert.equal(await page.locator('#board .prism-gem').count(),1,'reused prism keeps its original special animation');
  });

  await t.test('concurrent lobby connections share one subscription',async()=>{
    await run(`window.savedFirebase={db,fbDoc,fbGetDoc,fbSetDoc,fbOnSnapshot};window.subscriptions=0;window.reads=0;
      db={};fbDoc=()=>({});fbGetDoc=async()=>{reads++;return {exists:()=>true}};fbSetDoc=async()=>{};fbOnSnapshot=()=>{subscriptions++;return ()=>{}};
      onlineUnsubscribe=null;onlineRoomId='PERF01';`);
    try {await run('Promise.all([connectOnlineRoom(),connectOnlineRoom(),connectOnlineRoom()])');assert.deepEqual(await run('[reads,subscriptions]'),[1,1]);}
    finally {await run('({db,fbDoc,fbGetDoc,fbSetDoc,fbOnSnapshot}=savedFirebase);onlineUnsubscribe=null;');}
  });

  await t.test('native invitation, cancel, unsupported API and failed share all behave correctly',async()=>{
    await run(`onlineRoomId='ABC123';window.shares=[];window.copies=[];Object.defineProperty(navigator,'share',{configurable:true,writable:true,value:async data=>shares.push(data)});Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>copies.push(url)}});history.replaceState({},'','?game=ABC123&seat=0&dev=1');`);
    await run('invitePlayer()');
    assert.deepEqual(await run('shares.map(({title,text,url})=>({title,text,query:new URL(url).search}))'),[{title:'Joias Findom',text:'Vem jogar Joias Findom comigo!',query:'?game=ABC123'}]);
    await run("navigator.share=async()=>{throw new DOMException('cancel','AbortError')};invitePlayer();");
    await advance(50);assert.equal(await run('copies.length'),0);
    await run("navigator.share=undefined;invitePlayer();");
    await advance(50);assert.equal(await run('copies.length'),1);
    await run("navigator.share=async()=>{throw new DOMException('denied','NotAllowedError')};invitePlayer();");
    await advance(50);assert.equal(await run('copies.length'),2);
    assert.equal(await page.locator('#copyRoomBtn').isDisabled(),false);
  });

  await t.test('mobile/tablet/desktop share the same crisp jewels and curved beam geometry',async()=>{
    for(const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:1024});
      await run("showScreen('menuScreen');");
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.JOIAS_SCREENSHOT_DIR){await fs.mkdir(process.env.JOIAS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.JOIAS_SCREENSHOT_DIR,`menu-${width}.png`),fullPage:true});}
      await start();
      await run("state.playerScore=120;showPlayFeedback('player',{points:120,origin:rewardOrigin([{r:4,c:3}])});renderHud();");
      await advance(250);
      assert.equal(await page.locator('.energy-flight').count(),1);
      assert.equal(await page.locator('#board .jewel-face svg').count(),64);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.JOIAS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.JOIAS_SCREENSHOT_DIR,`beam-${width}.png`),fullPage:true});
      await page.setViewportSize({width:width+10,height:900});await page.evaluate(()=>scrollTo(0,250));await advance(100);
      await advance(32);
      assert.equal(await run('[...energyFlights].every(f=>f.revision===rewardGeometryRevision)'),true);
      await advance(1100);assert.equal(await page.locator('#playerScore').textContent(),'120');
      await page.evaluate(()=>scrollTo(0,0));
    }
  });
  assert.deepEqual(errors,[]);
});
