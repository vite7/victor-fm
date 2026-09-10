(async () => {
  'use strict';
  const canvas = document.querySelector('#clouds');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
  let paused = reduced.matches, frame = 0, time = 0, last = 0, lastCloudDraw = 0, lastRibbonDraw = 0, targetX = 0, targetY = 0, lookX = 0, lookY = 0;
  const vertex = `#version 300 es
in vec2 position; void main(){gl_Position=vec4(position,0.0,1.0);}`;
  const fragment = `#version 300 es
precision highp float;
precision highp sampler3D;
// Lighting adapted from whimSYZ/v-cloud (MIT, see assets/v-cloud-LICENSE.txt).
// Cloud morphology uses explicit soft-unioned cumulus banks, avoiding an opaque slab.
// Perlin-Worley density, height profiles, Beer-Lambert extinction and
// secondary light marching follow the Guerrilla volumetric cloud approach.
uniform vec2 resolution;
uniform float time;
uniform vec2 look;
uniform sampler3D volume;
out vec4 fragColor;
const vec3 SUN = vec3(-0.436,0.755,-0.49);
float remap01(float x,float lo){return clamp((x-lo)/max(1.0-lo,0.001),0.0,1.0);}
float ellipsoid(vec3 p,vec3 center,vec3 radius){return (length((p-center)/radius)-1.0)*min(radius.x,min(radius.y,radius.z));}
float unionSoft(float a,float b){float h=clamp(0.5+0.5*(b-a)/0.85,0.0,1.0);return mix(b,a,h)-0.85*h*(1.0-h);}
float density(vec3 p,bool detail){
  vec3 q=p;
  // A slow diagonal drift, with the noise field sliding at a slightly
  // different rate so the banks billow instead of moving like a flat plate.
  q.x+=time*0.055;
  q.y-=time*0.026;
  q.z=mod(q.z+time*0.105,55.0);
  // Separate cumulus banks surround an open flight corridor.
  float d=ellipsoid(q,vec3(-9.0,1.0,17.0),vec3(6.0,2.3,4.8));
  d=unionSoft(d,ellipsoid(q,vec3(-8.0,3.0,17.5),vec3(3.6,3.0,3.6)));
  d=unionSoft(d,ellipsoid(q,vec3(-5.4,1.5,17.0),vec3(3.0,2.2,3.5)));
  d=unionSoft(d,ellipsoid(q,vec3(8.0,-3.5,13.0),vec3(6.2,3.1,4.0)));
  d=unionSoft(d,ellipsoid(q,vec3(6.5,-1.0,14.0),vec3(3.2,2.4,3.0)));
  d=unionSoft(d,ellipsoid(q,vec3(-1.5,-6.0,18.0),vec3(7.0,3.0,5.0)));
  d=unionSoft(d,ellipsoid(q,vec3(9.0,5.5,29.0),vec3(6.0,2.8,5.0)));
  d=unionSoft(d,ellipsoid(q,vec3(5.5,6.3,29.0),vec3(3.1,2.3,3.6)));
  d=unionSoft(d,ellipsoid(q,vec3(-7.0,-1.5,38.0),vec3(5.5,2.8,4.0)));
  d=unionSoft(d,ellipsoid(q,vec3(5.0,-5.5,42.0),vec3(8.0,2.5,5.5)));
  if(d>1.6)return 0.0;
  vec3 billow=vec3(time*0.009,-time*0.006,time*0.004);
  vec4 n=texture(volume,q*0.19+billow);
  float displacement=(n.r-0.68)*3.15+(n.g-0.5)*0.58;
  if(detail)displacement+=(texture(volume,q*0.72-billow*1.7).b-0.5)*0.20;
  return smoothstep(0.0,0.8,-d+displacement)*1.25;
}
float opticalDepth(vec3 p){
  float optical=0.0,stepSize=0.25;
  for(int j=0;j<4;j++){
    p+=SUN*stepSize;
    optical+=density(p,false)*stepSize;
    stepSize*=2.25;
  }
  return optical;
}
float phaseHG(float cosine,float g){return (1.0-g*g)/pow(max(1.0+g*g-2.0*g*cosine,0.01),1.5);}
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*resolution)/resolution.y;
  vec3 rd=normalize(vec3(uv.x+look.x*0.08,uv.y*0.95+look.y*0.035,1.35));
  vec3 ro=vec3(0.0,sin(time*0.035)*0.12,0.0);
  float elevation=clamp(rd.y*0.8+0.55,0.0,1.0);
  vec3 sky=mix(vec3(0.65,0.82,0.95),vec3(0.055,0.30,0.66),elevation);
  float alignment=max(dot(rd,SUN),0.0);
  sky+=vec3(1.0,0.89,0.69)*pow(alignment,24.0)*0.12;
  float start=2.0;
  float end=52.0;
  float t=start;
  vec3 radiance=vec3(0.0);
  float transmission=1.0;
  float phase=0.8*phaseHG(dot(rd,SUN),0.5)+0.2*phaseHG(dot(rd,SUN),-0.2);
  for(int i=0;i<84;i++){
    if(t>=end||transmission<0.012)break;
    float ds=0.20+t*0.020;
    vec3 p=ro+rd*(t+ds*0.5);
    float d=density(p,true);
    if(d>0.002){
      float optical=opticalDepth(p);
      // Multiple-scattering approximation keeps deep shadows blue, not black.
      float light=exp(-optical*1.55)+0.32*exp(-optical*0.28);
      float powder=1.0-exp(-d*2.0);
      float h=clamp((p.y+5.0)/12.0,0.0,1.0);
      vec3 ambient=mix(vec3(0.18,0.27,0.40),vec3(0.42,0.55,0.70),h);
      vec3 sunlight=vec3(1.0,0.96,0.87)*light*(0.7+powder*0.3)*(0.7+phase*0.18);
      vec3 lighting=ambient*0.8+sunlight*1.12;
      lighting=mix(lighting,sky,1.0-exp(-t*0.006));
      float alpha=1.0-exp(-d*ds*1.65);
      radiance+=transmission*alpha*lighting;
      transmission*=1.0-alpha;
    }else if(i%4==0){
      // Light shafts are scattered sunlight occluded by the actual cloud volume.
      float visibility=exp(-opticalDepth(p)*1.55);
      float alpha=1.0-exp(-ds*0.003);
      radiance+=transmission*alpha*vec3(1.0,0.93,0.78)*visibility*phase*0.65;
      transmission*=1.0-alpha;
    }
    t+=ds;
  }
  vec3 color=radiance+transmission*sky;
  color=vec3(1.0)-exp(-max(color,vec3(0.0))*1.2);
  color=pow(color,vec3(1.0/2.2));
  fragColor=vec4(clamp(color,0.0,1.0),1.0);
}
`;
  let program, resolutionLocation, timeLocation, lookLocation;
  const ribbon=document.querySelector('#mobius');
  const ink=ribbon.getContext('2d');
  let ribbonWidth=0,ribbonHeight=0;
  const sky=document.querySelector('.sky');
  let viewWidth=0,viewHeight=0,quality=1,gpuFence=null;
  let interacting=false,touchActive=false,resumeTimer=0,resizePending=false;
  let gpuStarted=0,slowFrames=0,ribbonVisible=true,resizeTimer=0;
  const mesh=[];
  function surface(u,v){
    const x=1.7*Math.sin(u), y=0.76*Math.sin(2*u), z=0.43*Math.cos(u);
    const dx=1.7*Math.cos(u),dy=1.52*Math.cos(2*u),dz=-0.43*Math.sin(u);
    const len=Math.hypot(dx,dy,dz),xy=Math.hypot(dx,dy);
    const tx=dx/len,ty=dy/len,tz=dz/len;
    const nx=-dy/xy,ny=dx/xy;
    const bx=-tz*ny,by=tz*nx,bz=tx*ny-ty*nx;
    const c=Math.cos(u/2),s=Math.sin(u/2);
    return [x+v*(c*nx+s*bx),y+v*(c*ny+s*by),z+v*s*bz];
  }
  for(let j=0;j<=20;j++)for(let i=0;i<220;i++)mesh.push([surface(i/220*Math.PI*2,(j/20-.5)*.72),surface((i+1)/220*Math.PI*2,(j/20-.5)*.72),j===0||j===20]);
  for(let i=0;i<220;i+=4)for(let j=0;j<20;j++)mesh.push([surface(i/220*Math.PI*2,(j/20-.5)*.72),surface(i/220*Math.PI*2,((j+1)/20-.5)*.72),false]);
  function drawRibbon(){
    if(!ink)return;
    ink.clearRect(0,0,ribbonWidth,ribbonHeight);
    const yaw=time*.16+.25+lookX*.22,tilt=.27+Math.sin(time*.13)*.1+lookY*.1,roll=-.30;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt),cr=Math.cos(roll),sr=Math.sin(roll);
    const scale=Math.min(ribbonWidth*.245,ribbonHeight*.38);
    function project(p){let x=p[0]*cy+p[2]*sy,z=-p[0]*sy+p[2]*cy,y=p[1]*ct-z*st;z=p[1]*st+z*ct;const a=x*cr-y*sr,b=x*sr+y*cr,depth=6/(6-z);return [ribbonWidth*.53+a*scale*depth,ribbonHeight*.47+b*scale*depth,z];}
    // Preserve the mesh; replace thousands of strokes with 24 depth batches.
    const paths=Array.from({length:24},()=>new Path2D());
    for(const [a,b,edge] of mesh){const pa=project(a),pb=project(b);const depth=Math.max(0,Math.min(.999,((pa[2]+pb[2])*.5+2)/4));const path=paths[Math.floor(depth*12)*2+Number(edge)];path.moveTo(pa[0],pa[1]);path.lineTo(pb[0],pb[1]);}
    for(let i=0;i<12;i++){const depth=(i+.5)/12;ink.strokeStyle=`rgba(24,88,137,${.16+depth*.46})`;ink.lineWidth=.5+depth*.35;ink.stroke(paths[i*2]);ink.lineWidth=1.35;ink.stroke(paths[i*2+1]);}
  }
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
  function sizeCloudBuffer(){
    // A pixel-area budget also bounds work on tall portrait displays.
    const scale=Math.min(1,Math.sqrt(260000/(viewWidth*viewHeight)))*quality;
    const w=Math.max(1,Math.round(viewWidth*scale)),h=Math.max(1,Math.round(viewHeight*scale));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;if(gl)gl.viewport(0,0,w,h);}
  }
  function drawClouds(){
    if(!program||gl.isContextLost())return;
    // Backpressure: do not queue expensive frames behind a busy GPU.
    if(gpuFence){const status=gl.clientWaitSync(gpuFence,0,0);if(status===gl.TIMEOUT_EXPIRED)return;gl.deleteSync(gpuFence);gpuFence=null;
      if(performance.now()-gpuStarted>90)slowFrames++;else slowFrames=0;
      if(slowFrames>=4&&quality>.55){quality=Math.max(.55,quality*.85);sizeCloudBuffer();slowFrames=0;}
    }
    gl.uniform2f(resolutionLocation,canvas.width,canvas.height);gl.uniform1f(timeLocation,time);gl.uniform2f(lookLocation,lookX,lookY);gl.drawArrays(gl.TRIANGLES,0,6);
    gpuFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gpuStarted=performance.now();gl.flush();
  }
  function resize(){
    if(interacting||touchActive){resizePending=true;return;}
    resizePending=false;
    const rect=sky.getBoundingClientRect();
    if(viewWidth===rect.width&&viewHeight===rect.height)return;
    viewWidth=rect.width;viewHeight=rect.height;sizeCloudBuffer();
    const bounds=ribbon.getBoundingClientRect();ribbonWidth=bounds.width;ribbonHeight=bounds.height;
    const ratio=Math.min(devicePixelRatio||1,1.5);ribbon.width=Math.round(ribbonWidth*ratio);ribbon.height=Math.round(ribbonHeight*ratio);if(ink)ink.setTransform(ratio,0,0,ratio,0,0);
    drawRibbon();drawClouds();
  }
  function animate(now){
    frame=0;if(paused||document.hidden||interacting||touchActive||(!program&&!ink))return;
    const dt=last?Math.min((now-last)/1000,.06):0;last=now;
    // During scrolling, retain the last sky frame and resume without a jump.
    {time+=dt;const smoothing=1-Math.exp(-dt*2);lookX+=(targetX-lookX)*smoothing;lookY+=(targetY-lookY)*smoothing;
      if(now-lastCloudDraw>=50){drawClouds();lastCloudDraw=now-now%50;}
      if(ribbonVisible&&now-lastRibbonDraw>=33.333){drawRibbon();lastRibbonDraw=now-now%33.333;}
    }
    frame=requestAnimationFrame(animate);
  }
  function sync(){if(!paused&&!document.hidden&&!interacting&&!touchActive&&!frame&&(program||ink)){last=0;frame=requestAnimationFrame(animate);}else if(paused||document.hidden||interacting||touchActive){cancelAnimationFrame(frame);frame=0;}}
  function holdMotion(){
    interacting=true;cancelAnimationFrame(frame);frame=0;last=0;slowFrames=0;
    clearTimeout(resumeTimer);
    resumeTimer=setTimeout(()=>{if(touchActive)return;interacting=false;gpuStarted=performance.now();if(resizePending)resize();sync();},300);
  }
  try{
    if(!gl)throw new Error('WebGL unavailable');
    program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Cloud program could not link');gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const response=await fetch('assets/cloud-volume.bin');
    if(!response.ok)throw new Error('Cloud volume could not load');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==64*64*64*4)throw new Error('Invalid cloud volume');
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,texture);
    gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,64,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_R,gl.REPEAT);
    gl.uniform1i(gl.getUniformLocation(program,'volume'),0);resolutionLocation=gl.getUniformLocation(program,'resolution');timeLocation=gl.getUniformLocation(program,'time');lookLocation=gl.getUniformLocation(program,'look');resize();sync();
  }catch(error){program=null;canvas.style.display='none';resize();sync();}
    reduced.addEventListener('change',()=>{paused=reduced.matches;sync();});document.addEventListener('visibilitychange',sync);
    window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(resize,180);},{passive:true});
    window.addEventListener('scroll',holdMotion,{passive:true});
    window.addEventListener('wheel',holdMotion,{passive:true});
    window.addEventListener('touchstart',()=>{touchActive=true;holdMotion();},{passive:true});
    window.addEventListener('touchend',e=>{touchActive=e.touches.length>0;holdMotion();},{passive:true});
    window.addEventListener('touchcancel',()=>{touchActive=false;holdMotion();},{passive:true});
    window.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key))holdMotion();});
    document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',holdMotion));
    window.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;targetX=e.clientX/viewWidth-.5;targetY=.5-e.clientY/viewHeight;},{passive:true});
    if('IntersectionObserver' in window){new IntersectionObserver(entries=>{ribbonVisible=entries[0].isIntersecting;}).observe(ribbon);}
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(frame);frame=0;program=null;canvas.style.display='none';sync();});
  const contactDialog=document.querySelector('.contact-dialog');
  const contactForm=document.querySelector('#contact-form');
  let contactOpener=null;
  const closeContact=()=>contactDialog.close();
  document.querySelectorAll('[data-open-contact]').forEach(trigger=>trigger.addEventListener('click',()=>{contactOpener=trigger;interacting=true;cancelAnimationFrame(frame);frame=0;contactDialog.showModal();document.documentElement.classList.add('modal-open');contactDialog.querySelector('input').focus();}));
  contactDialog.querySelector('.contact-close').addEventListener('click',closeContact);
  contactDialog.addEventListener('close',()=>{document.documentElement.classList.remove('modal-open');interacting=false;last=0;sync();contactOpener?.focus();});
  contactDialog.addEventListener('click',event=>{const rect=contactDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeContact();});
  contactForm.addEventListener('submit',event=>{
    event.preventDefault();
    if(!contactForm.reportValidity())return;
    const data=new FormData(contactForm);
    const name=String(data.get('name')).trim(),email=String(data.get('email')).trim(),message=String(data.get('message')).trim();
    const subject=encodeURIComponent(`Website enquiry from ${name}`);
    const body=encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
    window.location.href=`mailto:victor@victor.fm?subject=${subject}&body=${body}`;
  });
  if('IntersectionObserver' in window&&!reduced.matches){const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target);}}),{threshold:.1});document.querySelectorAll('.about-copy,.section-top,.project,.connect>div:last-child').forEach(el=>{el.classList.add('reveal');observer.observe(el);});}
})();