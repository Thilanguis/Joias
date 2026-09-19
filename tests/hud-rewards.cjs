// Run: node --test tests/hud-rewards.cjs (requires Playwright; optional BROWSER_CHANNEL).
// The test server exposes module-local helpers only in its in-memory app.js response.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

test('reward flights preserve gameplay and land before HUD updates', async (t) => {
  const server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      let body = await fs.readFile(file);
      if (name === '/app.js') body += '\nwindow.__hudTest = (source) => eval(source);';
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 768, height: 1024 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.__hudTest);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const run = (source) => page.evaluate((code) => window.__hudTest(code), source);
  const text = (id) => page.locator('#' + id).textContent();
  const start = (format = 'race') => run(`startGame({opponentType:'bot',format:'${format}',duration:60}); stopTimers();`);
  const advance = (ms) => page.clock.runFor(ms);

  await t.test('full flights read at the match, travel, hover, hit, then update on tablet and mobile', async () => {
    for (const width of [768,390]) {
      await page.setViewportSize({width,height:844});
      await start();
      await run("$('devTools').hidden=true;");
      if(width===390) await page.evaluate(()=>window.scrollTo(0,500));
      await run("state.playerTime+=4; showPlayFeedback('player',{seconds:4,origin:rewardOrigin([{r:4,c:3}])}); renderHud();");
      const token=page.locator('.reward-flight[data-destination="playerClock"]');
      const center=async(locator)=>{const box=await locator.boundingBox(); return {x:box.x+box.width/2,y:box.y+box.height/2};};
      const shot=async(phase)=>{
        if(!process.env.JOIAS_SCREENSHOT_DIR)return;
        await fs.mkdir(process.env.JOIAS_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.JOIAS_SCREENSHOT_DIR,`flight-${width}-${phase}.png`)});
      };
      await advance(150);
      const source=await center(token);
      const gem=await center(page.locator('#board .gem[data-r="4"][data-c="3"]'));
      assert.ok(Math.hypot(source.x-gem.x,source.y-gem.y)<20,'starts at the matched region');
      assert.equal(await token.getAttribute('data-phase'),'read');
      await shot('read');
      await advance(180);
      assert.deepEqual(await center(token),source,'read pause does not drift');
      await advance(370);
      const halfway=await center(token);
      const destination=await center(page.locator('#playerClock'));
      assert.equal(await token.getAttribute('data-phase'),'travel');
      assert.ok(Math.hypot(halfway.x-source.x,halfway.y-source.y)>70,'full board-to-HUD travel');
      assert.ok(Math.hypot(halfway.x-destination.x,halfway.y-destination.y)>60);
      assert.equal(await text('playerClock'),'60,0s');
      await shot('travel');
      await advance(320);
      const hover=await center(token);
      assert.equal(await token.getAttribute('data-phase'),'hover');
      await advance(70);
      assert.deepEqual(await center(token),hover,'pause just before arrival');
      await advance(230);
      assert.equal(await token.count(),0);
      assert.equal(await text('playerClock'),'60,0s','impact precedes the visual increment');
      assert.equal(await page.locator('#playerClockReward').evaluate(n=>n.classList.contains('visible')),true);
      await shot('impact');
      await advance(160);
      assert.equal(await text('playerClock'),'64,0s');
      await advance(700);
      assert.equal(await run('rewardFlights.size'),0);
      assert.equal(await text('playerClockReward'),'');
      await page.evaluate(()=>window.scrollTo(0,0));
    }
    await page.setViewportSize({width:768,height:1024});
  });

  await t.test('attack departs the attacker and flight geometry follows scroll and resize', async () => {
    await start();
    await run("$('devTools').hidden=true; const hit=applyDevilEffect('player',1); showDevilAttack('player',hit,hit,rewardOrigin([{r:2,c:2}])); renderHud();");
    await advance(500);
    assert.equal(await page.locator('.reward-flight').getAttribute('data-source'),'player');
    assert.equal(await page.locator('.reward-flight').getAttribute('data-destination'),'rivalClock');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.scrollTo(0,350));
    await advance(770);
    const token=await page.locator('.reward-flight').boundingBox();
    const target=await page.locator('#rivalClock').boundingBox();
    assert.ok(Math.hypot(token.x+token.width/2-target.x-target.width/2,token.y+token.height/2-target.y-target.height/2)<25);
    assert.equal(await text('rivalClock'),'60,0s');
    await advance(250);
    assert.equal(await text('rivalClock'),'58,0s');
    await start();
    assert.equal(await page.locator('.reward-flight').count(),0);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.setViewportSize({width:768,height:1024});
  });

  await t.test('accumulated reward flights stay separated near the bottom of mobile', async () => {
    await page.setViewportSize({width:390,height:844});
    await start();
    await run("$('devTools').hidden=true; state.playerScore=120; state.playerTime+=11; addBonusMoney('player',6); showPlayFeedback('player',{points:120,seconds:11,money:6,origin:rewardOrigin([{r:7,c:4}])}); renderHud();");
    await advance(350);
    const boxes=await page.locator('.reward-flight').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};}));
    assert.equal(boxes.length,3);
    for(let i=0;i<boxes.length;i++) {
      const a=boxes[i];
      assert.ok(a.left>=0 && a.right<=390 && a.top>=0 && a.bottom<=844);
      for(const b of boxes.slice(i+1)) assert.ok(a.bottom<=b.top || b.bottom<=a.top || a.right<=b.left || b.right<=a.left);
    }
    await start();
    assert.equal(await page.locator('.reward-flight').count(),0);
    await page.setViewportSize({width:768,height:1024});
  });

  await t.test('cascade totals read first, real rules apply immediately, each destination releases separately', async () => {
    await start();
    await run(`window.batch = createCascadeRewards();
      setScore('player',120); addBonusMoney('player',3); collectCascadeFeedback('player',batch,120,3);
      renderHud();`);
    await advance(900);
    assert.equal(await text('playerScore'), '0');
    assert.equal(await text('playerMoney'), 'R$ 0,00');
    await run(`setScore('player',320); addBonusMoney('player',3); collectCascadeFeedback('player',batch,200,3);
      batch.seconds=11; batch.clockCount=2; batch.devilCount=1; finalizeCascadeRewards('player',batch);`);
    assert.deepEqual(await run('[state.playerScore,state.playerTime,state.playerBonusMoney,state.playerClockFreeze,state.rivalTime]'), [320,71,6,20,58]);
    assert.equal(await text('playerClock'), '60,0s');
    assert.equal(await text('rivalClock'), '60,0s');
    await advance(600);
    assert.equal(await text('playerScoreReward'), '+320');
    assert.equal(await text('playerClockReward'), '+11s');
    assert.equal(await text('playerMoneyReward'), '+R$ 6,00');
    assert.equal(await text('rivalClockReward'), '😈 −2s');
    assert.equal(await text('playerScore'), '0');
    assert.equal(await text('playerFreeze'), '⏸ CONGELADO · 20,0s');
    await advance(1000);
    assert.equal(await text('rivalClock'), '60,0s');
    assert.equal(await text('playerClock'), '71,0s');
    await advance(600);
    assert.equal(await text('rivalClock'), '58,0s');
    assert.equal(await text('playerScore'), '320');
    assert.equal(await text('playerClock'), '71,0s');
    assert.equal(await text('playerMoney'), 'R$ 9,20');
    await advance(700);
    assert.equal(await text('playerScoreReward'), '');
    assert.equal(await run('hudHolds.size'), 0);
  });

  await t.test('freeze stacks, counts tenths, and resumes only after the remainder is consumed', async () => {
    await start();
    await run("addClockFreeze('player',2); state.lastTickAt=performance.now(); timerId=setInterval(tickRace,100); renderHud();");
    await advance(1100);
    assert.equal(await text('playerFreeze'), '⏸ CONGELADO · 18,9s');
    assert.equal(await run('state.playerTime'), 60);
    await run("setClockFreeze('player',0.15);");
    await advance(300);
    assert.equal(await run("clockFreezeFor('player')"), 0);
    assert.ok((await run('state.playerTime')) < 60);
    assert.equal(await page.locator('#playerFreeze').evaluate((node) => node.classList.contains('active')), false);
    await run('stopTimers()');
  });

  await t.test('turn rewards, next-turn penalty and crown move duration retain their rules', async () => {
    await start('turns');
    await run("window.batch=createCascadeRewards(); batch.moves=2; batch.devilCount=1; finalizeCascadeRewards('player',batch); activateCrownBoost('player',2);");
    assert.deepEqual(await run('[state.movesLeft,state.turnTimeLeft,state.rivalTurnPenalty,crownMultiplierFor("player"),crownBoostFor("player")]'), [5,90,5,4,3]);
    assert.equal(await text('playerMoves'), '3 MOV.');
    assert.equal(await text('rivalClock'), '90,0s');
    await advance(600);
    assert.equal(await text('playerMovesReward'), '+2 MOV.');
    assert.equal(await text('rivalClockReward'), '😈 −5s PRÓX.');
    assert.equal(await text('playerCrownBoostTimeReward'), '👑 x4');
    await advance(1500);
    assert.equal(await text('playerMoves'), '5 MOV.');
    assert.equal(await text('rivalClock'), '85,0s');
    assert.equal(await text('playerCrownBoostTime'), 'x4 · 3 jog.');
    await run("consumeCrownMove('player'); renderHud();");
    assert.equal(await text('playerCrownBoostTime'), 'x4 · 2 jog.');
    await run("resetTurnClock('rival');");
    assert.equal(await run('state.turnTimeLeft'), 85);
  });

  await t.test('both sides and overlapping destinations settle without losing or replaying gains', async () => {
    await start();
    await run("state.playerTime+=4; showPlayFeedback('player',{seconds:4}); state.rivalTime+=6; showPlayFeedback('rival',{seconds:6}); const hit=applyDevilEffect('rival',1); showDevilAttack('rival',hit); renderHud();");
    await advance(200);
    assert.equal(await text('playerClock'), '60,0s');
    assert.equal(await text('rivalClock'), '60,0s');
    await advance(1300);
    assert.equal(await text('playerClock'), '64,0s');
    await advance(2900);
    assert.equal(await text('playerClock'), '62,0s');
    assert.equal(await text('rivalClock'), '66,0s');
    assert.equal(await run('hudHolds.size'), 0);
  });

  await t.test('remote snapshots animate deltas once, reuse money DOM, and do not invent gains from ticking', async () => {
    await start();
    await run(`state.opponentType='online'; state.onlineMatchId='test'; onlineSeat=0;
      window.snapshot={matchId:'test',status:'playing',currentSeat:0,currentRound:1,movesLeft:3,players:{
        0:{board:plainBoard(state.board),score:0,time:60,seq:0},
        1:{board:plainBoard(state.rivalBoard),score:120,bonusMoney:3,time:64,crownBoost:8,crownLevel:1,seq:1}
      }};
      window.moneyNode=$('moneyLeadValue'); window.rivalGem=$('rivalBoard').firstChild; syncOnlineGameFromSnapshot(snapshot,{});`);
    await advance(400);
    assert.equal(await text('rivalScoreReward'), '+120');
    assert.equal(await text('rivalMoneyReward'), '+R$ 3,00');
    assert.equal(await text('rivalClockReward'), '+4s');
    await advance(2300);
    await run("state.rivalTime-=0.2; syncOnlineGameFromSnapshot(snapshot,{});");
    assert.equal(await text('rivalClockReward'), '');
    assert.equal(await run("moneyNode===$('moneyLeadValue')"), true);
    assert.equal(await run("rivalGem===$('rivalBoard').firstChild"), true);
    assert.equal(await text('rivalMoney'), 'R$ 4,20');
    assert.equal(await run('hudHolds.size'), 0);
    await run("for(let i=0;i<4;i++){ state.rivalScore+=10; showPlayFeedback('rival',{points:10}); } renderHud();");
    assert.equal(await run("hudLanes.get('rivalScoreReward').length"),2);
    await advance(2300);
    assert.equal(await text('rivalScoreReward'),'+30');
    await advance(2200);
    assert.equal(await text('rivalScore'),'160');
    assert.equal(await run('hudHolds.size'),0);
  });

  await t.test('an attack on the last move still reads before the new turn clock changes', async () => {
    await start('turns');
    await run("const hit=applyDevilEffect('player',1); showDevilAttack('player',hit); state.currentSide='rival'; resetTurnClock('rival'); renderHud();");
    assert.equal(await run('state.turnTimeLeft'),85);
    assert.equal(await text('rivalClock'),'90,0s');
    await advance(1550);
    assert.equal(await text('rivalClock'),'85,0s');
  });

  await t.test('real swaps, direct special combinations and Dev Tools complete their cascades', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await run('window.originalRandom=Math.random; window.seed=47; Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);');
    const finishAction = async () => {
      for (let i=0;i<80 && !(await run('window.actionDone'));i++) await advance(500);
      assert.equal(await run('window.actionDone'),true,'cascade completed');
      assert.equal(await run('window.actionError'),null);
      await advance(2800);
      assert.equal(await text('playerScore'),await run("state.playerScore.toLocaleString('pt-BR')"));
      assert.equal(await run('hudHolds.size'),0);
      assert.equal(await run('busy.player'),false);
      assert.equal(await run('findMatches(state.board).matched.size'),0);
    };
    for (const scenario of ['normal','direct','clock','cash','crown','devil']) {
      await start();
      await run(`window.actionDone=false; window.actionError=null;
        for (const row of state.board) for (const cell of row) {cell.power=null;cell.special=null;}
        if ('${scenario}'==='normal') {
          const move=allValidMoves(state.board)[0];
          performSwap('player',move.a,move.b).then(()=>window.actionDone=true).catch(e=>{window.actionError=e.message;window.actionDone=true;});
        } else if ('${scenario}'==='direct') {
          state.board[3][3].special='bomb'; state.board[3][4].special='row'; renderBoard('player');
          performSwap('player',{r:3,c:3},{r:3,c:4}).then(()=>window.actionDone=true).catch(e=>{window.actionError=e.message;window.actionDone=true;});
        } else {
          placeDevPreset('${scenario}');
          executeDevPiece().then(()=>window.actionDone=true).catch(e=>{window.actionError=e.message;window.actionDone=true;});
        }
        void 0;`);
      await finishAction();
      assert.ok((await run('state.playerScore'))>0,scenario);
      if(scenario==='clock') assert.ok((await run('state.playerClockFreeze'))>=10);
      if(scenario==='cash') assert.ok((await run('state.playerBonusMoney'))>=3);
      if(scenario==='crown') assert.ok((await run("crownMultiplierFor('player')"))>=2);
      if(scenario==='devil') assert.ok((await run('state.rivalTime'))<=58);
    }
    await run('Math.random=originalRandom;');
    await page.emulateMedia({ reducedMotion:'no-preference' });
  });

  await t.test('restart clears pending feedback; final reward remains readable before results', async () => {
    await start();
    await run("setScore('player',120); showPlayFeedback('player',{points:120});");
    await advance(200);
    await start();
    await advance(1500);
    assert.equal(await text('playerScore'), '0');
    assert.equal(await text('playerScoreReward'), '');
    await run("setScore('player',120); showPlayFeedback('player',{points:120}); finishGame();");
    assert.equal(await run('state.finished'), true);
    await advance(300);
    assert.equal(await page.locator('#gameScreen').isVisible(), true);
    assert.equal(await text('playerScoreReward'), '+120');
    await advance(2100);
    assert.equal(await page.locator('#resultScreen').isVisible(), true);
    assert.equal(await text('finalPlayer'), '120');
  });

  await t.test('tablet/mobile widths and reduced motion keep chips within their HUD destination', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320,390,768,1024]) {
      await page.setViewportSize({width,height:1024});
      await start('turns');
      await run("setScore('player',120); addBonusMoney('player',6); state.movesLeft+=2; showPlayFeedback('player',{points:120,money:6,moves:2}); addClockFreeze('player',2); activateCrownBoost('player',3); const hit=applyDevilEffect('player',1); showDevilAttack('player',hit); renderHud(); $('devTools').hidden=true;");
      await advance(600);
      assert.equal(await text('playerScore'), '0');
      const layout = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('.hud-reward.visible')];
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          escaped: nodes.filter((node) => {const a=node.getBoundingClientRect(),b=node.closest('.hud-side').getBoundingClientRect();return a.left<b.left || a.right>b.right || node.scrollWidth>node.clientWidth;}).map(n=>n.id) };
      });
      if(process.env.JOIAS_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.JOIAS_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.JOIAS_SCREENSHOT_DIR,`hud-${width}.png`)});
      }
      assert.equal(layout.overflow,false,`viewport ${width}`);
      assert.deepEqual(layout.escaped,[],`rewards at ${width}`);
      if(width===390) {
        await page.evaluate(()=>window.scrollTo(0,300));
        assert.ok((await page.locator('.hud').boundingBox()).y>=0);
        assert.ok((await page.locator('.hud').boundingBox()).y<10);
        await page.evaluate(()=>window.scrollTo(0,0));
      }
      await advance(2100);
      assert.equal(await text('playerScore'),'120');
      assert.equal(await text('playerScoreReward'),'');
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await t.test('solo race fits mobile and keeps its HUD visible while scrolling', async () => {
    await page.setViewportSize({width:390,height:844});
    await run("startGame({opponentType:'solo',format:'race',duration:60}); stopTimers(); state.playerTime+=11; showPlayFeedback('player',{seconds:11}); addClockFreeze('player',1); renderHud(); $('devTools').hidden=true;");
    await advance(250);
    assert.equal(await page.locator('#rivalHud').isVisible(),false);
    assert.equal(await page.locator('#playerMovesMetric').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.evaluate(()=>window.scrollTo(0,300));
    const box=await page.locator('.hud').boundingBox();
    assert.ok(box.y>=0 && box.y+box.height<844); // Solo may fit without scrolling, below the brand masthead.
    if(process.env.JOIAS_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.JOIAS_SCREENSHOT_DIR,'hud-solo-390.png')});
    await page.evaluate(()=>window.scrollTo(0,0));
  });

  await t.test('power sounds follow actual rewards, aggregate cascades and deduplicate online events', async () => {
    await run('window.savedPowerSound=playPowerSound; window.audioCalls=[]; playPowerSound=(kind,side)=>audioCalls.push([kind,side]);');
    try {
      await start();
      await run(`finalizeCascadeRewards('player',{...createCascadeRewards(),seconds:4,moves:2});`);
      assert.deepEqual(await run('audioCalls'),[], 'race time bonus is not an extra move');
      await start('turns');
      await run(`audioCalls=[]; finalizeCascadeRewards('player',{...createCascadeRewards(),moves:2,clockCount:2,devilCount:2,money:6}); activateCrownBoost('player',2);`);
      await advance(500);
      assert.deepEqual(await run('audioCalls'),[['moves','player'],['clock','player'],['devil','player'],['crown','player'],['cash','player']]);
      assert.equal(await run('state.movesLeft'),5);
      await run(`audioCalls=[]; state.rivalTurnPenalty=TURN_SECONDS-MIN_TURN_SECONDS; applyDevilEffect('player',1); state.opponentType='solo'; applyDevilEffect('player',1);`);
      assert.deepEqual(await run('audioCalls'),[], 'no attack sound when no penalty is applied');
      await start();
      await run(`audioCalls=[]; state.opponentType='online'; activateCrownBoost('player'); addClockFreeze('player'); applyDevilEffect('player',1);`);
      assert.deepEqual(await run('state.powerAudioEvents'),{crown:1,clock:1,devil:1});
      await run(`audioCalls=[]; syncPowerAudio({clock:2,moves:1,crown:3,devil:1}); syncPowerAudio({clock:2,moves:1,crown:3,devil:1}); syncPowerAudio({clock:1});`);
      assert.deepEqual(await run('audioCalls'),[['clock','rival'],['moves','rival'],['crown','rival'],['devil','rival']]);
      await run(`audioCalls=[]; syncPowerAudio({clock:2,moves:1,crown:3,devil:2});`);
      assert.deepEqual(await run('audioCalls'),[['devil','rival']]);
      await run(`audioCalls=[]; onlineSeat=0; window.soundSnapshot={matchId:'audio-test',status:'playing',format:'race',players:{
        0:{board:plainBoard(state.board),score:0,time:60,seq:0},
        1:{board:plainBoard(state.rivalBoard),score:0,time:60,seq:0,powerAudioEvents:{devil:4,clock:2,moves:1,crown:3}}
      }}; startOnlineGameFromSnapshot(soundSnapshot,{}); stopTimers(); syncOnlineGameFromSnapshot(soundSnapshot,{});`);
      assert.deepEqual(await run('audioCalls'),[], 'joining does not replay earlier powers');
      await run(`soundSnapshot.players[1].powerAudioEvents.devil=5; soundSnapshot.players[0].time=58;
        syncOnlineGameFromSnapshot(soundSnapshot,{}); syncOnlineGameFromSnapshot(soundSnapshot,{});`);
      assert.deepEqual(await run('audioCalls'),[['devil','rival']], 'incoming online attack plays once');
      await run(`soundSnapshot.players[0].time=55; syncOnlineGameFromSnapshot(soundSnapshot,{});`);
      assert.deepEqual(await run('audioCalls'),[['devil','rival']], 'time correction alone is not an attack sound');
    } finally { await run('playPowerSound=savedPowerSound;'); await start(); }
  });

  await t.test('real MP3s decode; mixer limits overlap, prioritizes attacks, ducks and resets', async () => {
    const audioContext=await browser.newContext({serviceWorkers:'block'});
    const audioPage=await audioContext.newPage();
    try {
      await audioPage.goto(`http://127.0.0.1:${server.address().port}/`);
      await audioPage.locator('#opponentSelect').selectOption('solo');
      await audioPage.locator('#startBtn').click();
      const audioRun=(code)=>audioPage.evaluate(source=>window.__hudTest(source),code);
      const audioAct=(code)=>audioRun(`(async()=>{${code}})()`);
      await audioRun('stopTimers(); unlockMatchAudio();');
      const durations=await audioRun(`Promise.all(Object.keys(POWER_AUDIO).map(async kind=>[kind,(await loadPowerAudio(kind))?.duration])).then(Object.fromEntries)`);
      t.diagnostic('MP3 durations: '+JSON.stringify(durations));
      for(const duration of Object.values(durations)) assert.ok(duration>0);
      for(const [kind,side] of [['clock','player'],['cash','rival'],['crown','player'],['moves','player']]) {
        await audioAct(`resetPowerAudio(); await playPowerSound('${kind}','${side}');`);
        await audioPage.waitForTimeout(80);
        const playing=await audioRun(`({kind:[...activePowerAudio][0]?.kind,volume:[...activePowerAudio][0]?.gain.gain.value,duck:commonAudioGain.gain.value,loop:[...activePowerAudio][0]?.source.loop})`);
        assert.equal(playing.kind,kind);
        assert.equal(playing.loop,false);
        assert.ok(playing.duck<0.85);
        if(side==='rival') assert.ok(playing.volume<0.25,'rival is quieter');
      }
      await audioAct(`resetPowerAudio(); await playPowerSound('clock','player');`);
      await audioPage.waitForTimeout(1450);
      assert.equal(await audioRun('activePowerAudio.size'),0,'clock cue ends long before the freeze');
      await audioPage.waitForTimeout(250);
      assert.ok(await audioRun('commonAudioGain.gain.value>0.98'),'ordinary audio recovers smoothly');
      await audioAct(`resetPowerAudio(); await playPowerSound('moves','rival'); await playPowerSound('crown','rival');`);
      await audioPage.waitForTimeout(220);
      await audioAct(`await playPowerSound('devil','rival'); await playPowerSound('devil','rival');`);
      await audioPage.waitForTimeout(220);
      assert.ok(await audioRun(`activePowerAudio.size<=2 && [...activePowerAudio].some(j=>j.kind==='devil' && j.priority===3)`));
      assert.equal(await audioRun(`[...activePowerAudio,...powerAudioQueue].filter(j=>j.kind==='devil').length`),1);
      await audioAct(`await playMatchSound('player',3); await playBombSound('player');`);
      assert.ok(await audioRun('matchAudioBuffer.duration>0 && bombAudioBuffer.duration>0'));
      await audioAct(`resetPowerAudio(); await playPowerSound('crown','player'); await playPowerSound('cash','player'); startGame({opponentType:'solo'}); stopTimers();`);
      assert.equal(await audioRun('activePowerAudio.size+powerAudioQueue.length'),0);
    } finally { await audioContext.close(); }
  });

  await t.test('PWA caches the new version and opens offline', async () => {
    const offlineContext=await browser.newContext({serviceWorkers:'allow'});
    try {
      const offlinePage=await offlineContext.newPage();
      await offlinePage.goto(`http://127.0.0.1:${server.address().port}/`);
      await offlinePage.evaluate(async()=>{await navigator.serviceWorker.ready;});
      await offlinePage.waitForFunction(()=>!!navigator.serviceWorker.controller);
      assert.ok((await offlinePage.evaluate(()=>caches.keys())).includes('joias-findom-v23-power-audio'));
      assert.equal(await offlinePage.evaluate(async()=>{
        const cache=await caches.open('joias-findom-v23-power-audio');
        return !!(await cache.match(new URL('./jewel-theme.css',location.href).href));
      }),true,'art direction is cached for offline play');
      await offlineContext.setOffline(true);
      await offlinePage.reload();
      assert.equal(await offlinePage.title(),'Joias Findom');
      await offlinePage.locator('#opponentSelect').selectOption('solo');
      await offlinePage.locator('#startBtn').click();
      assert.equal(await offlinePage.locator('#gameScreen').isVisible(),true);
      assert.equal(await offlinePage.locator('#board .gem').count(),64);
      const offlineSounds=await offlinePage.evaluate(()=>window.__hudTest(`Promise.all(Object.keys(POWER_AUDIO).map(async kind=>!!(await loadPowerAudio(kind))))`));
      assert.deepEqual(offlineSounds,[true,true,true,true,true],'all five power MP3s decode offline');
    } finally {await offlineContext.close();}
  });
  assert.deepEqual(errors, []);
});
