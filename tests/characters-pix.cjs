const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {openGame}=require('./browser-harness.cjs');

test('characters and PIX: rules, ownership, reconnect and responsive controls',async t=>{
  const g=await openGame({reducedMotion:'reduce'}),{page,run}=g;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(()=>g.close());
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  const advance=ms=>page.clock.runFor(ms);
  const start=(character='prism',format='turns',type='bot')=>run(`startGame({opponentType:'${type}',format:'${format}',profile:{name:'Ana',pix:'ana@example.com',character:'${character}'}});stopTimers();$('devTools').hidden=true;`);
  const finishPower=async()=>{for(let i=0;i<100 && !(await run('window.powerDone'));i++)await advance(500);assert.equal(await run('window.powerDone'),true);assert.equal(await run('window.powerError'),null);};

  await t.test('PIX uses the workspace validator for normalization and checksum errors',async()=>{
    const cases=[['529.982.247-25',true,'52998224725'],['11.222.333/0001-81',true,'11222333000181'],['(11) 99999-9999',true,'+5511999999999'],['ana@example.com',true,'ana@example.com'],['123e4567-e89b-42d3-a456-426614174000',true,'123e4567-e89b-42d3-a456-426614174000'],['111.111.111-11',false],['12.345.678/0001-00',false],['not-a-key',false]];
    for(const [input,valid,key] of cases){const actual=await page.evaluate(x=>PixPayment.normalizeKey(x),input);assert.equal(actual.valid,valid,input);if(valid)assert.equal(actual.key,key);}
    await run("$('playerPixInput').value='bad-key';");assert.equal(await run('validateMenuProfile(true)'),null);
    await run("$('playerPixInput').value='';");assert.equal(await run('validateMenuProfile(true)'),null);
    assert.ok(await run('validateMenuProfile(false)'));
  });

  await t.test('actual cascade charge uses base score before crown and saturates at ready',async()=>{
    await start('time','race');
    await run(`state.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>makeCell((r*2+c)%6,null,null)));
      for(let c=0;c<3;c++)state.board[0][c].type=0;
      setCrownBoostLevel('player',3);setCrownBoost('player',10);renderBoard('player');
      window.powerDone=false;window.powerError=null;void resolveMatches('player').then(()=>powerDone=true).catch(e=>{powerError=e.message;powerDone=true;});`);
    await finishPower();
    const data=await run('[state.playerScore,state.playerHero.charge,crownMultiplierFor("player")]');
    assert.equal(data[2],8);assert.equal(data[1],Math.min(850,data[0]/8));
    await run("chargeCharacter('player',5000);renderHud();");
    assert.equal(await run('state.playerHero.charge'),850);assert.equal(await page.locator('#playerCharacterStatus').textContent(),'ESPECIAL PRONTO');
  });

  for(const format of ['race','turns'])for(const character of ['prism','chaos','time','demolition']){
    await t.test(`${character} resolves once in ${format}, keeps moves and cannot recharge itself`,async()=>{
      await start(character,format);
      await run(`state.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>makeCell((r*2+c)%6,null,null)));renderBoard('player');
        chargeCharacter('player',10000);window.beforeMoves=state.movesLeft;window.beforeBoard=JSON.stringify(plainBoard(state.board));
        window.powerDone=false;window.powerError=null;void useCharacter('player').then(()=>powerDone=true).catch(e=>{powerError=e.message;powerDone=true;});`);
      assert.equal(await run("useCharacter('player')"),false);
      await finishPower();
      assert.deepEqual(await run('[state.playerHero.charge,state.playerHero.uses,busy.player,state.playerHero.active]'),[0,1,false,false]);
      if(character==='time'){
        assert.equal(await run('state.playerClockFreeze'),10);
        assert.equal(await run('state.playerTime'),format==='race'?63:60);
        assert.equal(await run('state.movesLeft'),format==='turns'?4:3);
      }else if(character==='chaos'){
        assert.equal(await run('state.rivalTime'),format==='race'?54:60);
        assert.equal(await run('state.rivalTurnPenalty'),format==='turns'?20:0);
        assert.equal(await run('JSON.stringify(plainBoard(state.board))===beforeBoard'),true);
      }else{
        assert.ok(await run('state.playerScore>0'));
        assert.equal(await page.locator('#board .gem').count(),64);
        assert.equal(await run('findMatches(state.board).matched.size'),0);
      }
      await run("chargeCharacter('player',10000);state.currentSide='rival';renderHud();");
      if(format==='turns')assert.equal(await run("canUseCharacter('player')"),false);
    });
  }

  await t.test('restart during special leaves the new game untouched',async()=>{
    await start('demolition');
    await run("chargeCharacter('player',10000);void useCharacter('player');");
    await start('time');await advance(4000);
    assert.deepEqual(await run('[state.playerScore,state.playerHero.uses,state.playerHero.charge,busy.player]'),[0,0,0,false]);
  });

  await t.test('seat-owned profiles, charge and attack ledger survive repeat snapshots and reconnect',async()=>{
    await start('chaos','race');
    await run(`onlineSeat=1;onlineRoomId='TEST12';fbDoc=()=>({});window.writes=[];fbUpdateDoc=async(ref,data)=>writes.push(data);
      window.snapshot={matchId:'heroes-test',format:'race',status:'playing',duration:60,pointValue:.01,currentSeat:1,players:{
        0:{profile:{name:'Bia',pix:'bia@example.com',character:'chaos'},hero:{charge:0,uses:1,attacksSent:2},board:plainBoard(state.rivalBoard),time:60,score:0,seq:0},
        1:{profile:{name:'Ana',pix:'ana@example.com',character:'time'},hero:{charge:850,attacksSeen:0},board:plainBoard(state.board),time:60,score:0,seq:0}}};
      startOnlineGameFromSnapshot(snapshot,{names:['wrong','wrong']});stopTimers();`);
    assert.equal(await run('state.playerTime'),54);
    assert.equal(await run("sideName('player')"),'Ana');
    assert.equal(await run('state.playerHero.charge'),850);
    await run('syncOnlineGameFromSnapshot(snapshot,{});syncOnlineGameFromSnapshot(snapshot,{});');
    assert.equal(await run('state.playerTime'),54,'same attack never applies twice');
    assert.ok(await run("writes.some(w=>w['match.players.1']?.hero?.attacksSeen===2)"));
    assert.equal(await run("writes.some(w=>Object.keys(w).some(k=>k.startsWith('match.players.0')))"),false,'receiver never overwrites rival');
    await run("snapshot.players[1]=writes.filter(w=>w['match.players.1']).at(-1)['match.players.1'];startOnlineGameFromSnapshot(snapshot,{});stopTimers();");
    assert.equal(await run('state.playerTime'),54,'acknowledgement survives reconnect');
    await run("snapshot.players[0].hero.attacksSent=4;syncOnlineGameFromSnapshot(snapshot,{});");assert.equal(await run('state.playerTime'),48);
    await run("window.profileWrites=[];fbSetDoc=async(ref,data)=>profileWrites.push(data);$('opponentSelect').value='online';$('playerNameInput').value='Ana';$('playerPixInput').value='ana@example.com';saveOwnOnlineProfile();");
    assert.deepEqual(await run('Object.keys(profileWrites[0].lobby.profiles)'),['1']);
    assert.equal(await run('profileWrites[0].lobby.ready[1]'),false);
    await run("$('opponentSelect').value='bot:jade';onlineSeat=null;onlineRoomId=null;");
  });

  await t.test('PIX follows immutable match profiles, handles ties/bonuses and copies the receiver key',async()=>{
    await start();
    await run(`state.opponentType='online';state.onlineSeat=0;state.onlineNames=['Ana','Bia'];
      state.playerProfile={name:'Ana',pix:'ana@example.com',character:'prism'};state.rivalProfile={name:'Bia',pix:'bia@example.com',character:'time'};
      state.playerScore=100;state.rivalScore=200;state.playerBonusMoney=3;finishGame();`);
    assert.equal(await page.locator('#resultPixTitle').textContent(),'Recebe: Ana');
    assert.equal(await page.locator('#resultPixAmount').textContent(),'R$ 2,00');
    assert.match(await page.locator('#resultPixContext').textContent(),/Bia/);
    await page.evaluate(()=>{window.copiedPix='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async key=>window.copiedPix=key}});});
    await page.locator('#copyPixBtn').click();assert.equal(await page.evaluate(()=>copiedPix),'ana@example.com');
    await run("state.playerBonusMoney=1;renderResultPix(resultPayload());");assert.equal(await page.locator('#resultPix').isVisible(),false,'zero settlement has no PIX');
    await run("state.playerBonusMoney=0;state.rivalProfile.pix='bad';renderResultPix(resultPayload());");assert.equal(await page.locator('#copyPixBtn').isDisabled(),true);
    await start('time','race','solo');await run('finishGame();');assert.equal(await page.locator('#resultPix').isVisible(),false);
  });

  await t.test('all characters and ready controls fit phone/tablet without horizontal overflow',async()=>{
    for(const width of [320,390,768,1024]){
      await page.setViewportSize({width,height:1024});await run("showScreen('menuScreen');renderCharacterChoices();");
      assert.equal(await page.locator('[data-character]').count(),4);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await start('time');await run("chargeCharacter('player',1000);renderHud();");
      assert.ok(await page.locator('#playerSpecial').isEnabled());
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
  });
  assert.deepEqual(errors,[]);
});
