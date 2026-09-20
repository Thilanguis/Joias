const {test}=require('node:test');
const assert=require('node:assert/strict');
const {openGame}=require('./browser-harness.cjs');

test('two online clients keep distinct profiles, activate powers and agree on PIX',async t=>{
  const first=await openGame({reducedMotion:'reduce'});
  const context=await first.browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',viewport:{width:768,height:1024}});
  const secondPage=await context.newPage();await secondPage.goto(first.page.url());
  await secondPage.waitForFunction(()=>!!window.__hudTest);
  const clients=[first,{page:secondPage,run:code=>secondPage.evaluate(source=>window.__hudTest(source),code)}];
  t.after(()=>first.close());
  let document={lobby:{ready:{0:false,1:false},profiles:{},config:{format:'race',duration:60,pointValue:.01}}};
  const merge=(target,source)=>{for(const [key,value] of Object.entries(source)){if(value && typeof value==='object' && !Array.isArray(value)){if(!target[key]||typeof target[key]!=='object')target[key]={};merge(target[key],value);}else target[key]=value;}};
  const update=patch=>{for(const [path,value] of Object.entries(patch)){const keys=path.split('.');let node=document;for(const key of keys.slice(0,-1))node=node[key] ||= {};node[keys.at(-1)]=value;}};
  for(let seat=0;seat<2;seat++){
    const client=clients[seat];
    await client.page.exposeFunction('testSet',async data=>merge(document,data));
    await client.page.exposeFunction('testUpdate',async data=>update(data));
    await client.run(`ensureFirebase=async()=>true;fbDoc=()=>({});fbSetDoc=async(ref,data)=>testSet(data);fbUpdateDoc=async(ref,data)=>testUpdate(data);
      onlineSeat=${seat};onlineRoomId='TEST12';onlineLobby=${JSON.stringify(document.lobby)};
      $('opponentSelect').value='online';$('playerNameInput').value='${seat?'Bia':'Ana'}';$('playerPixInput').value='${seat?'bia':'ana'}@example.com';
      $('characterChoices').dataset.selected='${seat?'time':'chaos'}';`);
  }
  await Promise.all(clients.map(c=>c.run('toggleOnlineReady()')));
  assert.deepEqual(document.lobby.ready,{0:true,1:true});
  assert.equal(document.lobby.profiles[0].character,'chaos');
  assert.equal(document.lobby.profiles[1].character,'time');
  await first.run(`onlineLobby=${JSON.stringify(document.lobby)};startOnlineMatchAsHost();`);
  assert.equal(document.match.players[0].profile.pix,'ana@example.com');
  const deliver=async()=>{
    const snapshot=JSON.stringify(document);
    for(const c of clients)await c.run(`{const doc=${snapshot};syncOnlineGameFromSnapshot(doc.match,doc.lobby);stopTimers();}`);
  };
  await deliver();
  await first.run("chargeCharacter('player',10000);useCharacter('player');");
  assert.equal(document.match.players[0].hero.attacksSent,2);
  await deliver();await deliver();
  assert.equal(await clients[1].run('state.playerTime'),54);
  await clients[1].run("chargeCharacter('player',10000);useCharacter('player');");
  assert.equal(document.match.players[1].clockFreeze,10);
  assert.equal(document.match.players[1].time,57);
  await deliver();
  assert.equal(await first.run('state.rivalHero.uses'),1);
  assert.equal(await first.run('state.rivalTime'),57);
  // A new document load uses the persisted acknowledgement, not zero.
  await clients[1].run(`startOnlineGameFromSnapshot(${JSON.stringify(document.match)},${JSON.stringify(document.lobby)});stopTimers();`);
  assert.equal(await clients[1].run('state.playerTime'),57);
  // Both screens must identify exactly the same recipient and key.
  document.match.players[0].score=500;document.match.players[1].score=200;
  document.match.players[0].seq+=5;document.match.players[1].seq+=5;
  document.match.status='finished';
  await deliver();
  for(const c of clients){assert.equal(await c.page.locator('#resultPixTitle').textContent(),'Recebe: Ana');assert.equal(await c.page.locator('#resultPixKey').textContent(),'ana@example.com');assert.equal(await c.page.locator('#resultPixAmount').textContent(),'R$ 3,00');}
  document.lobby.config.format='turns';document.lobby.ready={0:true,1:true};
  await first.run(`onlineLobby=${JSON.stringify(document.lobby)};startOnlineMatchAsHost();`);
  await deliver();
  assert.equal(await clients[1].run("canUseCharacter('player')"),false,'cannot use during rival turn');
  await first.run("chargeCharacter('player',10000);useCharacter('player');");
  await deliver();await deliver();
  assert.equal(await clients[1].run('state.playerTurnPenalty'),20);
  await first.run("resetTurnClock('rival');setOnlineTurnState({currentSeat:1,currentRound:1,movesLeft:3,turnTimeLeft:state.turnTimeLeft});");
  await deliver();
  assert.equal(await clients[1].run('state.turnTimeLeft'),70);
  await clients[1].run("chargeCharacter('player',10000);useCharacter('player');");
  assert.equal(document.match.movesLeft,4,'manual extra move publishes shared turn count immediately');
  await deliver();await deliver();
  assert.equal(await clients[1].run('state.movesLeft'),4);
  assert.equal(await first.run('state.movesLeft'),4);
});
