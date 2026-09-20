const {test}=require('node:test');
const assert=require('node:assert/strict');
const {openGame}=require('./browser-harness.cjs');

test('Dev Tools: powers, resources, outcomes and online ownership',async t=>{
  const g=await openGame({reducedMotion:'reduce'}),{page,run}=g;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>g.close());
  const start=(format='race')=>run(`onlineSeat=null;onlineRoomId=null;startGame({opponentType:'bot',format:'${format}',profile:{name:'Ana',character:'prism'}});stopTimers();$('devSide').value='player';collapseDevTools(false);`);

  await t.test('real controls change character, preview without charge and activate the actual power',async()=>{
    await start();
    await page.locator('#devCharacter').selectOption('time');await page.locator('[data-dev-action="character"]').click();
    assert.equal(await run('state.playerHero.id'),'time');
    await page.locator('[data-dev-action="preview"]').click();
    assert.deepEqual(await run('[state.playerHero.charge,state.playerHero.uses,state.playerClockFreeze]'),[0,0,0]);
    assert.equal(await page.locator('#devBody').isVisible(),false);
    await page.locator('#devModeBadge').click();
    await page.locator('[data-dev-action="charge"]').click();assert.equal(await run('state.playerHero.charge'),850);
    await page.locator('[data-dev-action="empty"]').click();assert.equal(await run('state.playerHero.charge'),0);
    await page.locator('[data-dev-action="use"]').click();
    await page.waitForFunction(()=>window.__hudTest('!devActionPending'));
    assert.deepEqual(await run('[state.playerHero.uses,state.playerClockFreeze,state.playerTime]'),[1,10,63]);
    assert.equal(await page.locator('#devBody').isVisible(),false);
  });

  await t.test('resource shortcuts use the chosen side and preserve mode/turn restrictions',async()=>{
    await start();
    for(const action of ['points','cash','time','freeze'])await run(`runDevAction('${action}')`);
    assert.deepEqual(await run('[state.playerScore,state.playerHero.charge,state.playerBonusMoney,state.playerTime,state.playerClockFreeze]'),[500,500,3,90,10]);
    await run("runDevAction('thaw')");assert.equal(await run('state.playerClockFreeze'),0);
    await run("runDevAction('moves')");assert.match(await page.locator('#devStatus').textContent(),/somente/);
    await start('turns');await run("runDevAction('moves')");await run("runDevAction('time')");
    assert.deepEqual(await run('[state.movesLeft,state.turnTimeLeft]'),[6,120]);
    await run("$('devSide').value='rival';");await run("runDevAction('time')");await run("runDevAction('use')");
    assert.deepEqual(await run('[state.turnTimeLeft,state.rivalHero.charge,state.rivalHero.uses]'),[120,0,0]);
    await run("busy.player=true;$('devSide').value='player';window.beforeBoard=JSON.stringify(plainBoard(state.board));placeDevPreset('bomb');");
    assert.equal(await run('JSON.stringify(plainBoard(state.board))===beforeBoard'),true);
    await run('busy.player=false;');
  });

  await t.test('finish keeps the current score or simulates each result without changing money rules',async()=>{
    for(const outcome of ['current','win','lose','draw']){
      await start();await run(`state.playerScore=100;state.rivalScore=200;state.playerBonusMoney=3;$('devOutcome').value='${outcome}';`);
      await page.locator('[data-dev-action="finish"]').click();
      await page.locator('#resultScreen').waitFor({state:'visible'});
      assert.equal(await run('state.finished'),true);
      const result=await run('resultPayload()');
      assert.equal(result.playerBonusMoney,3);
      assert.equal(result.moneyDelta,Math.round(((result.playerScore-result.opponentScore)*.01+3)*100)/100);
      if(outcome==='current')assert.deepEqual([result.playerScore,result.opponentScore],[100,200]);
      else if(outcome==='win')assert.equal(result.won,true);
      else if(outcome==='lose')assert.equal(result.won,false);
      else assert.equal(result.draw,true);
    }
  });

  await t.test('online actions publish only the local seat and refuse rival edits or simulated outcomes',async()=>{
    await start('turns');await run(`state.opponentType='online';onlineSeat=0;state.onlineSeat=0;onlineRoomId='TEST12';
      fbDoc=()=>({});window.devWrites=[];fbUpdateDoc=async(ref,data)=>devWrites.push(data);`);
    await run("runDevAction('moves')");
    assert.equal(await run("devWrites.at(-1)['match.movesLeft']"),6);
    assert.ok(await run("!!devWrites.at(-1)['match.players.0']"));
    await run("$('devSide').value='rival';");await run("runDevAction('points')");
    assert.equal(await run('state.rivalScore'),0);
    await run("$('devSide').value='player';$('devCharacter').value='time';");await run("runDevAction('character')");
    assert.equal(await run('state.playerHero.id'),'prism');
    await run("$('devOutcome').value='win';");await run("runDevAction('finish')");assert.equal(await run('state.finished'),false);
    await run("$('devOutcome').value='current';");await run("runDevAction('finish')");
    assert.equal(await run('state.finished'),true);
    assert.ok(await run("devWrites.some(w=>w['match.status']==='finished')"));
    assert.equal(await run("devWrites.some(w=>w['match.players.1'])"),false);
  });

  await t.test('panel fits narrow phones and tablets and can reopen from the DEV badge',async()=>{
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:844});await start();
      const box=await page.locator('#devTools').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width);
      assert.equal(await page.locator('#devTools').evaluate(e=>e.scrollWidth>e.clientWidth),false);
      await page.locator('#devCollapseBtn').click();assert.equal(await page.locator('#devBody').isVisible(),false);
      await page.locator('#devModeBadge').click();assert.equal(await page.locator('#devBody').isVisible(),true);
    }
  });
  assert.deepEqual(errors,[]);
});
