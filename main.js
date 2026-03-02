// Galton board using Matter.js
(function(){
  const { Engine, Render, Runner, Composite, Bodies, Body, Events, Vector } = Matter;

  const board = document.getElementById('board');
  const hist = document.getElementById('hist');
  const pegLayout = document.getElementById('pegLayout');
  const pegEInput = document.getElementById('pegE'); // eccentricity
  const pegBInput = document.getElementById('pegB');
  const ballRadiusInput = document.getElementById('ballRadius');
  const spawnCountInput = document.getElementById('spawnCount');
  const spawnBtn = document.getElementById('spawnBtn');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const stats = document.getElementById('stats');

  function setupCanvas(canvas){
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, Math.floor(rect.width * dpr));
    canvas.height = Math.max(200, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return ctx;
  }

  const ctxHist = setupCanvas(hist);

  let width = board.clientWidth, height = board.clientHeight;

  const engine = Engine.create();
  engine.gravity.y = 1; // tune

  const render = Render.create({
    canvas: board,
    engine: engine,
    options: {
      width: board.clientWidth,
      height: board.clientHeight,
      wireframes: false,
      background: 'transparent',
      showAngleIndicator: false
    }
  });

  const runner = Runner.create();

  // state
  let pegs = [];
  let balls = [];
  let bins = [];
  const binCount = 80;

  function resize(){
    width = board.clientWidth; height = board.clientHeight;
    render.canvas.width = board.clientWidth * (window.devicePixelRatio||1);
    render.canvas.height = board.clientHeight * (window.devicePixelRatio||1);
    render.options.width = board.clientWidth;
    render.options.height = board.clientHeight;
    ctxHist.setTransform(1,0,0,1,0,0);
    setupCanvas(hist);
  }

  function clearWorld(){
    Composite.clear(engine.world, false);
    pegs = [];
    balls = [];
  }

  function createBounds(){
    const thickness = 40;
    const floor = Bodies.rectangle(width/2, height + thickness/2 - 6, width, thickness, { isStatic: true, label: 'floor' });
    const left = Bodies.rectangle(-thickness/2, height/2, thickness, height, { isStatic: true });
    const right = Bodies.rectangle(width + thickness/2, height/2, thickness, height, { isStatic: true });
    Composite.add(engine.world, [floor, left, right]);
  }

  function createPegs(){
    // remove old pegs
    pegs.forEach(p=>Composite.remove(engine.world, p));
    pegs = [];
    const e = Math.max(0, Math.min(0.95, parseFloat(pegEInput.value)||0));
    const b = parseFloat(pegBInput.value);
    // compute semi-major a from eccentricity: e = sqrt(1 - b^2/a^2)  => a = b / sqrt(1-e^2)
    let a = b / Math.sqrt(Math.max(1e-6, 1 - e*e));
    // cap a to avoid extreme spacing
    a = Math.min(a, Math.max(40, b*8, 200));
    const useA = Math.max(a,b);
    // ensure spacing doesn't collapse when eccentricity is low; require a minimum based on b
    const spacing = Math.max(useA * 2.6, b * 4);
    const cols = Math.max(2, Math.floor(width / spacing));
    const startY = 80;
    const rows = Math.floor((height-200)/spacing);
    for(let row=0; row<rows; row++){
      for(let col=0; col<cols; col++){
        const offset = (row%2)*spacing*0.5;
        const x = spacing*col + offset + (width - spacing*cols)/2 + spacing/2;
        const y = startY + row*spacing;
        let peg = Bodies.circle(x,y,b, { isStatic:true, restitution:0.4, friction:0.02, render:{fillStyle:'#e6f7f2'} });
        if(a !== b){ Body.scale(peg, a/b, 1); }
        pegs.push(peg);
      }
    }
    Composite.add(engine.world, pegs);
  }

  function spawnBall(x,y){
    const r = parseFloat(ballRadiusInput.value);
    const b = Bodies.circle(x, y, r, { restitution:0.4, friction:0.01, density:0.001, label: 'ball', collisionFilter: { group: -1 }, render:{fillStyle:'#ffcc66'} });
    balls.push(b);
    Composite.add(engine.world, b);
  }

  function spawnMany(n){
    const e = Math.max(0, Math.min(0.95, parseFloat(pegEInput.value)||0));
    // derive spacing similarly to createPegs to determine reasonable spread
    const b = parseFloat(pegBInput.value);
    let a = b / Math.sqrt(Math.max(1e-6, 1 - e*e));
    a = Math.min(a, Math.max(40, b*8, 200));
    const useA = Math.max(a,b);
    const spacing = Math.max(useA * 2.6, b * 4);
    // when eccentricity decreases (more circular), increase spawn spread so balls fit between pegs
    const adjustment = 1 + (1 - e) * 0.8;
    const spread = spacing * adjustment;
    for(let i=0;i<n;i++){
      const jitter = (Math.random()-0.5) * spread;
      spawnBall(width/2 + jitter, 30 + Math.random()*10);
    }
  }

  function reset(){
    clearWorld();
    createBounds();
    createPegs();
    bins = new Array(binCount).fill(0);
  }

  // collision handling: when ball hits floor, record bin and remove
  Events.on(engine, 'collisionStart', function(event){
    const pairs = event.pairs;
    for(const p of pairs){
      const labels = [p.bodyA.label, p.bodyB.label];
      if(labels.includes('floor')){
        const ballBody = p.bodyA.label === 'floor' ? p.bodyB : p.bodyA;
        if(ballBody && ballBody.circleRadius){
          const x = ballBody.position.x;
          const bin = Math.floor((x/width) * binCount);
          if(bin >=0 && bin < binCount) bins[bin]++;
          // remove ball on next tick
          setTimeout(()=>{ try{ Composite.remove(engine.world, ballBody); }catch(e){} }, 0);
        }
      }
    }
  });

  // Nudge stalled balls: tiny random impulse if speed is very low while above bins
  Events.on(engine, 'afterUpdate', function(){
    for(const b of balls){
      if(!b || b.isSleeping) continue;
      // skip if already below floor area
      if(b.position.y > height - 60) continue;
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if(speed < 0.06){
        const fx = (Math.random()-0.5) * 6e-5;
        const fy = -Math.random() * 2e-5;
        try{ Body.applyForce(b, b.position, { x: fx, y: fy }); }catch(e){}
      }
    }
  });

  // UI
  spawnBtn.addEventListener('click', ()=>{ const n = parseInt(spawnCountInput.value,10)||100; spawnMany(n); });
  startBtn.addEventListener('click', ()=>{ Runner.start(runner, engine); });
  pauseBtn.addEventListener('click', ()=>{ Runner.stop(runner); });
  resetBtn.addEventListener('click', ()=>{ reset(); });
  pegEInput.addEventListener('input', ()=>{ createPegs(); });
  pegBInput.addEventListener('input', ()=>{ createPegs(); });
  pegLayout.addEventListener('change', ()=>{ createPegs(); });

  // histogram draw loop
  function drawHist(){
    const ctx = ctxHist;
    ctx.clearRect(0,0,hist.clientWidth,hist.clientHeight);
    const w = hist.clientWidth, h = hist.clientHeight;
    const maxv = Math.max(1, ...bins);
    const bw = w / binCount;
    ctx.fillStyle = '#6dd3c9';
    for(let i=0;i<binCount;i++){
      const v = bins[i]||0; const hh = (v/maxv)*(h-6);
      ctx.fillRect(i*bw, h-hh, Math.max(1,bw-1), hh);
    }
    ctx.fillStyle = '#cfe'; ctx.font='12px system-ui';
    ctx.fillText(`Balls: ${balls.length} | Pegs: ${pegs.length} | Collected: ${bins.reduce((a,b)=>a+b,0)}`, 6, 14);
    requestAnimationFrame(drawHist);
  }

  // start
  Render.run(render);
  Runner.run(runner, engine);

  // initial
  reset();
  // spawn a few
  spawnMany(200);
  drawHist();

  // resize handling
  window.addEventListener('resize', ()=>{ resize(); reset(); });

})();
