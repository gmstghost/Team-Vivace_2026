const {app, BrowserWindow, protocol, net, dialog} = require('electron');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const fs = require('node:fs');
protocol.registerSchemesAsPrivileged([{scheme:'safe', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.whenReady().then(async () => {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'public') : path.join(__dirname, '..', 'public');
  protocol.handle('safe', request => {
    const url = new URL(request.url);
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if(url.host !== 'app' || !target.startsWith(root + path.sep)) return new Response('Forbidden', {status:403});
    return net.fetch(pathToFileURL(target).href);
  });
  const win = new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,title:'SAFE Route',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.setMenu(null);
  const ses = win.webContents.session;
  ses.setPermissionCheckHandler((wc, permission, origin) => wc === win.webContents && permission === 'serial' && origin === 'safe://app');
  ses.on('select-serial-port', async (event, ports, wc, callback) => {
    event.preventDefault();
    if(wc !== win.webContents || !ports.length) {
      callback('');
      if(!ports.length) await dialog.showMessageBox(win,{message:'연결된 시리얼 장치가 없습니다.',detail:'아두이노를 USB로 연결한 뒤 다시 시도하세요.'});
      return;
    }
    try {
      const result = await dialog.showMessageBox(win,{title:'아두이노 포트 선택',message:'연결할 장치를 선택하세요.',buttons:[...ports.map(p=>p.displayName ? `${p.portName} — ${p.displayName}` : p.portName),'취소'],cancelId:ports.length,noLink:true});
      callback(ports[result.response]?.portId || '');
    } catch { callback(''); }
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('safe://app/'))event.preventDefault();});
  await win.loadURL('safe://app/');
});
app.on('window-all-closed',()=>app.quit());
