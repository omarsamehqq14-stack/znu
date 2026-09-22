const $ = (id) => document.getElementById(id);
let ws = null, role = null, roomCode = null, lastPayload = null, stream = null;
const els = {home:$('home'),send:$('send'),receive:$('receive'),dot:$('dot'),status:$('statusText'),toast:$('toast')};
function toast(msg){els.toast.textContent=msg;els.toast.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.add('hidden'),2600)}
function setStatus(ok,text,bad=false){els.dot.className='dot '+(ok?'ok':bad?'bad':'');els.status.textContent=text}
function show(name){['home','send','receive'].forEach(x=>$(x).classList.toggle('hidden',x!==name));}
function wsUrl(){
  const configured=window.QR_RELAY_CONFIG?.websocketUrl?.trim();
  if(configured && !configured.includes('YOUR-BACKEND-DOMAIN')) return configured.replace(/\/$/,'');
  const p=location.protocol==='https:'?'wss':'ws';
  return `${p}://${location.host}`;
}
function connect(){
  if(ws && ws.readyState<=1)return;
  setStatus(false,'Connecting…'); ws=new WebSocket(wsUrl());
  ws.onopen=()=>{setStatus(true,'Connected');if(role==='receiver') ws.send(JSON.stringify({type:'create'}));};
  ws.onclose=()=>{setStatus(false,'Offline',true); if(role==='receiver') $('roomCode').textContent='------'; toast('Connection closed.');};
  ws.onerror=()=>setStatus(false,'Connection error',true);
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handleMessage(m)};
}
function send(m){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));else toast('Not connected.');}
function handleMessage(m){
  if(m.type==='created'){roomCode=m.code;$('roomCode').textContent=m.code;setStatus(true,'Session ready');return}
  if(m.type==='joined'){roomCode=m.code;$('sendPair').classList.add('hidden');$('sendMain').classList.remove('hidden');setPeer(true,'Connected');if(m.payload)receivePayload(m.payload,m.at);startCamera();return}
  if(m.type==='peer_connected'){setPeer(true,'Sender connected');return}
  if(m.type==='peer_disconnected'){setPeer(false,'Sender disconnected');return}
  if(m.type==='payload'){receivePayload(m.payload,m.at);return}
  if(m.type==='sent'){return}
  if(m.type==='error'){toast(m.message||'Server error');if(m.code==='NOT_FOUND')$('joinError').textContent=m.message;return}
}
function setPeer(ok,text){if(role==='sender'){ $('sendPeerDot').className='dot '+(ok?'ok':'bad');$('sendPeer').textContent=text } else {$('recvPeerDot').className='dot '+(ok?'ok':'');$('recvPeer').textContent=text}}
function receivePayload(payload,at){
  $('recvPayload').textContent=payload; $('recvTime').textContent='Updated '+new Date(at||Date.now()).toLocaleTimeString();
  const wrap=$('qr').parentElement; wrap.innerHTML='<div id=qrBox></div>'; try{new QRCode($('qrBox'),{text:payload,width:700,height:700,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});toast('New QR received')}catch(e){toast('Could not generate QR')}
}
async function startCamera(){
  stopCamera();
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    $('video').srcObject=stream;
    await $('video').play();
    setStatus(true,'Camera ready');
    if('BarcodeDetector' in window){
      const detector=new BarcodeDetector({formats:['qr_code']});
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
      let busy=false;
      const loop=async()=>{
        if(!stream||role!=='sender'||$('sendMain').classList.contains('hidden'))return;
        if(!busy && $('video').readyState>=2){busy=true;try{canvas.width=$('video').videoWidth;canvas.height=$('video').videoHeight;ctx.drawImage($('video'),0,0,canvas.width,canvas.height);const codes=await detector.detect(canvas);if(codes[0]?.rawValue)publish(codes[0].rawValue)}catch(e){}busy=false}
        requestAnimationFrame(loop)
      }; loop();
    }else if(window.jsQR){
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
      const loop=()=>{ if(!stream||role!=='sender'||$('sendMain').classList.contains('hidden'))return; if($('video').readyState>=2){canvas.width=$('video').videoWidth;canvas.height=$('video').videoHeight;ctx.drawImage($('video'),0,0,canvas.width,canvas.height);const image=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});if(code?.data)publish(code.data)} requestAnimationFrame(loop)}; loop();
    }else{toast('This browser cannot scan QR codes. Please use a modern Android Chrome browser.');}
  }catch(e){toast('Camera permission was denied or the camera is unavailable.');setStatus(false,'Camera unavailable',true)}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}$('video').srcObject=null}
function publish(payload){if(typeof payload!=='string'||!payload||payload===lastPayload)return;lastPayload=payload;$('sendPayload').textContent=payload;$('sendTime').textContent='Sent '+new Date().toLocaleTimeString();send({type:'payload',payload})}
function join(){const code=$('joinCode').value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code)){ $('joinError').textContent='Enter the 6-character pairing code.';return } $('joinError').textContent='';send({type:'join',code})}
function disconnect(){stopCamera();if(ws){try{ws.send(JSON.stringify({type:'leave'}))}catch{}ws.close()}ws=null;role=null;roomCode=null;lastPayload=null;show('home');setStatus(false,'Offline')}
$('goSend').onclick=()=>{role='sender';show('send');$('sendPair').classList.remove('hidden');$('sendMain').classList.add('hidden');connect()};
$('goReceive').onclick=()=>{role='receiver';show('receive');connect()};
$('joinBtn').onclick=join;$('joinCode').onkeydown=e=>{if(e.key==='Enter')join()};$('cameraBtn').onclick=startCamera;$('disconnectSend').onclick=disconnect;$('disconnectRecv').onclick=disconnect;$('sendBack').onclick=disconnect;$('receiveBack').onclick=disconnect;
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast('Pairing code copied')}catch{toast(roomCode)}};
window.addEventListener('beforeunload',stopCamera);
