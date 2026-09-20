// Comparable DOM/layout workload on the same browser; not a physical-phone FPS claim.
const {openGame} = require('./browser-harness.cjs');
(async()=>{
  const game=await openGame();
  try {
    await game.run("startGame({opponentType:'bot',format:'race'});stopTimers();$('devTools').hidden=true;");
    const cdp=await game.context.newCDPSession(game.page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const measure=await game.run(`(()=>{
      const root=$('board'),before=[...root.children];
      const observer=new MutationObserver(()=>{});observer.observe($('gameScreen'),{subtree:true,childList:true,attributes:true,characterData:true});
      let t=performance.now();for(let i=0;i<100;i++)renderHud();
      const hudMs=performance.now()-t,hudMutations=observer.takeRecords().length;
      t=performance.now();for(let i=0;i<20;i++)renderBoard('player');
      const boardMs=performance.now()-t,records=observer.takeRecords();observer.disconnect();
      return {hudMs,hudMutations,boardMs,boardAddedNodes:records.reduce((n,r)=>n+r.addedNodes.length,0),reused:before.filter(n=>n.parentElement===root).length};
    })()`);
    const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    await game.page.waitForTimeout(1500);
    const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    console.log(JSON.stringify({...measure,idleLayoutCount:after.LayoutCount-before.LayoutCount,idleStyleRecalcCount:after.RecalcStyleCount-before.RecalcStyleCount},null,2));
  } finally {await game.close();}
})();
