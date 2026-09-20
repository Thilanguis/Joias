const {test}=require('node:test');
const assert=require('node:assert/strict');
const {openGame}=require('./browser-harness.cjs');

test('full-art invocations preserve input, power timing and lifecycle',async t=>{
  const g=await openGame(),{page,run}=g;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(()=>g.close());
  const start=id=>run(`startGame({opponentType:'bot',format:'race',profile:{name:'Ana',character:'${id}'}});stopTimers();$('devTools').hidden=true;`);

  await t.test('a real ready-button click applies the power during the portrait, without a second use',async()=>{
    await start('time');await run("chargeCharacter('player',2000);renderHud();");
    await page.locator('#playerSpecial').click();
    assert.equal(await page.locator('.character-cast[data-side="player"]').count(),1);
    assert.equal(await page.locator('.cast-art img').getAttribute('src'),'./assets/characters/time.webp');
    assert.deepEqual(await run('[state.playerHero.uses,state.playerHero.charge,state.playerClockFreeze,state.playerTime]'),[1,0,10,63]);
    assert.equal(await run("useCharacter('player')"),false);
    assert.equal(await page.evaluate(()=>{
      const art=document.querySelector('.cast-art'),r=art.getBoundingClientRect();
      return !document.querySelector('.character-cast').contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    }),true,'presentation cannot intercept board/HUD input');
    await page.locator('.character-cast').waitFor({state:'detached',timeout:3000});
  });

  await t.test('all full portraits fit phone, landscape and tablet even with an offscreen own board',async()=>{
    for(const [id,width,height] of [['prism',320,568],['chaos',390,844],['time',768,1024],['demolition',844,390]]){
      await page.setViewportSize({width,height});await start(id);
      await run("boardRoot('player').classList.add('offscreen');animateCharacterUse('player');");
      await page.locator('.character-cast').evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=600;}));
      const image=page.locator('.cast-art img');await image.evaluate(i=>i.decode());
      assert.equal(await image.getAttribute('src'),`./assets/characters/${id}.webp`);
      assert.equal(await image.evaluate(i=>getComputedStyle(i).objectFit),'contain');
      const box=await page.locator('.cast-scene').boundingBox();
      assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=height,`${id}: full scene inside ${width}x${height}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await run('resetHudRewards();');
      assert.equal(await page.locator('.character-cast').count(),0);
    }
  });

  await t.test('local activation takes priority and no portrait survives a restart or screen exit',async()=>{
    await start('prism');
    await run("boardRoot('rival').classList.remove('offscreen');animateCharacterUse('rival');");
    assert.equal(await page.locator('.character-cast').getAttribute('data-side'),'rival');
    await run("animateCharacterUse('player');animateCharacterUse('rival');");
    assert.equal(await page.locator('.character-cast').count(),1);
    assert.equal(await page.locator('.character-cast').getAttribute('data-side'),'player');
    await start('chaos');assert.equal(await page.locator('.character-cast').count(),0);
    await run("animateCharacterUse('player');showScreen('menuScreen');");
    assert.equal(await page.locator('.character-cast').count(),0);
  });

  await t.test('reduced motion keeps the full art with opacity only and cleans itself up',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'});await start('demolition');
    await run("animateCharacterUse('player');");
    assert.equal(await page.locator('.cast-spark').count(),0);
    assert.equal(await page.locator('.cast-scene').evaluate(e=>e.getAnimations()[0].effect.getKeyframes().some(f=>f.transform)),false);
    await page.locator('.character-cast').waitFor({state:'detached',timeout:2500});
  });
  assert.deepEqual(errors,[]);
});
