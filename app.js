import {todayInMelbourne, project, updateStock, validateMedicine, emptyState, validateState, TIMEZONE} from './inventory.mjs';
import {KEY, LOCK, read, write, parseBackup} from './storage.mjs';

const $ = id => document.getElementById(id);
const el = (tag, className = '', value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
  const shapes = {
    pill: ['M9.2 4.8a5.65 5.65 0 0 1 8 8l-4.4 4.4a5.65 5.65 0 0 1-8-8z','m7 7 10 10'],
    arrow: ['M5 12h14','m14 7 5 5-5 5'],
    edit: ['m15 4 5 5-11 11H4v-5z','m12 7 5 5'],
  };
  for (const d of shapes[name] || []) {const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.append(p);}
  return svg;
};
const button = (label, className, handler) => {const b=el('button',className,label);b.type='button';b.addEventListener('click',handler);return b;};
const formatNumber = n => new Intl.NumberFormat('en-AU',{maximumFractionDigits:2}).format(n);
const dateLabel = (day, full = false) => new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',day:'numeric',month:full?'long':'short',...(full?{year:'numeric'}:{})}).format(new Date(`${day}T12:00:00Z`));
const clone = value => JSON.parse(JSON.stringify(value));
let storage;
try { storage=window.localStorage; } catch { storage=null; }
let result=read(storage), state=result.state||emptyState(), raw=result.raw, storageError=result.error;
let demo=false, demoSaved=null, filter='all', search='', undoRecord=null, busy=false;
let dialogRaw=null, opener=null, installEvent=null, registration=null, reloadRequested=false;
const sheet=$('sheet');
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');

function notify(message, undoable=false) {
  $('toast-message').textContent=message;
  $('undo').hidden=!undoable;
  $('toast').hidden=false;
}
function applyTheme() {
  const theme=state.theme==='system'?(systemTheme.matches?'dark':'light'):state.theme;
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#101720':'#f6f8fb';
}
function showError(form, error) {
  const node=form.querySelector('[role="alert"]');
  node.textContent=error instanceof Error?error.message:String(error);
  node.hidden=false;node.focus();
}
function formError() {const n=el('p','form-error');n.setAttribute('role','alert');n.tabIndex=-1;n.hidden=true;return n;}
function refreshStored() {
  if (demo) return;
  result=read(storage);raw=result.raw;storageError=result.error;
  state=result.state||emptyState();
  render();
}
/** Persist before showing success. Web Locks serialize writes by this app across tabs. */
async function commit(change, message, expectedRaw=raw, allowRestore=false) {
  if (busy) throw new Error('A save is already in progress.');
  if (storageError && !demo && !allowRestore) throw new Error(storageError);
  busy=true;
  try {
    const before=clone(state);
    const next=validateState(change(clone(state)));
    next.history=[{at:new Date().toISOString(),text:message},...next.history].slice(0,100);
    const save=()=>{
      if (demo) return {state:validateState({...next,revision:next.revision+1}),raw};
      return write(storage,next,expectedRaw);
    };
    const saved=(!demo && navigator.locks?.request)?await navigator.locks.request(LOCK,save):save();
    state=saved.state;raw=saved.raw;storageError=null;
    undoRecord=allowRestore&&result.state===null?null:{before,expectedRaw:raw};
    render();notify(message,Boolean(undoRecord));
    return true;
  } finally {busy=false;}
}
async function perform(change,message,expectedRaw=raw) {
  try {await commit(change,message,expectedRaw);} catch(e) {notify(e.message);refreshStored();}
}
function openSheet(title,caption='') {
  if (!sheet.open) opener=document.activeElement;
  dialogRaw=raw;
  $('sheet-title').textContent=title;$('sheet-caption').textContent=caption;
  $('sheet-body').replaceChildren();
  if (!sheet.open) sheet.showModal();
  return $('sheet-body');
}
function closeSheet() {sheet.close();}
$('close-sheet').addEventListener('click',closeSheet);
sheet.addEventListener('close',()=>{
  if(opener?.isConnected) opener.focus();
  else {
    const label=opener?.getAttribute('aria-label');
    const replacement=label?[...document.querySelectorAll('button[aria-label]')].find(b=>b.getAttribute('aria-label')===label):null;
    (replacement||$('settings-button')).focus();
  }
});
function field(label,name,{value='',type='text',required=false,min,max,step,placeholder='',help='',maxLength}={}) {
  const wrapper=el('label','field');
  const labelNode=el('span','',label);labelNode.id=`label-${name}`;
  const input=el('input');input.name=name;input.type=type;input.value=value;input.required=required;input.placeholder=placeholder;
  input.id=`field-${name}`;input.autocomplete='off';input.setAttribute('aria-labelledby',labelNode.id);
  if(type==='number')input.inputMode='decimal';
  if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;if(maxLength)input.maxLength=maxLength;
  wrapper.append(labelNode,input);
  if(help){const note=el('small','',help);note.id=`help-${name}`;input.setAttribute('aria-describedby',note.id);wrapper.append(note);}
  return {wrapper,input};
}
function selector(label,name,options,value) {
  const wrapper=el('label','field'),select=el('select');select.name=name;select.id=`field-${name}`;
  for(const [v,title]of options){const option=el('option','',title);option.value=v;select.append(option);}
  select.value=value;wrapper.append(el('span','',label),select);return{wrapper,input:select};
}
const row=(...nodes)=>{const r=el('div','field-row');r.append(...nodes);return r;};
function footer(form,label='Save') {
  const wrap=el('div','form-footer');const cancel=button('Cancel','button secondary',closeSheet),submit=el('button','button primary',label);submit.type='submit';
  wrap.append(cancel,submit);form.append(wrap);return submit;
}

function render() {
  const active=document.activeElement;
  const focusedCard=active?.closest('.medicine')?.dataset.id;
  const focusedClass=focusedCard?active.className:null;
  applyTheme();const day=todayInMelbourne();
  $('today').textContent=new Intl.DateTimeFormat('en-AU',{timeZone:TIMEZONE,weekday:'long',day:'numeric',month:'long'}).format(new Date());
  $('demo-banner').hidden=!demo;$('storage-error').hidden=!storageError||demo;
  $('storage-error').textContent=storageError||'';
  $('inventory-count').textContent=state.medicines.length;
  const all=state.medicines.map(m=>({m,p:project(m,day)}));
  const warnings=all.filter(({p})=>p.clockWarning),low=all.filter(({p})=>p.needsRefill&&!p.clockWarning);
  const pending=low.filter(({m})=>m.ordered).length;
  renderSummary(all,low,warnings,pending,day);
  $('inventory-tools').hidden=all.length===0;
  $('empty').hidden=all.length!==0||Boolean(storageError&&!demo);
  $('queue-count').textContent=low.length+warnings.length;
  $('filter-all').setAttribute('aria-pressed',String(filter==='all'));
  $('filter-refill').setAttribute('aria-pressed',String(filter==='refill'));
  const chosen=all.filter(({m,p})=>(filter==='all'||p.needsRefill||p.clockWarning)&&`${m.name} ${m.strength}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a,b)=>Number(b.p.clockWarning)-Number(a.p.clockWarning)||Number(b.p.needsRefill)-Number(a.p.needsRefill)||(a.p.daysLeft??Infinity)-(b.p.daysLeft??Infinity)||a.m.name.localeCompare(b.m.name));
  $('medicine-list').replaceChildren(...chosen.map(({m,p})=>medicineCard(m,p,day)));
  $('no-results').hidden=all.length===0||chosen.length!==0;
  $('no-results').textContent=filter==='refill'&&!search?'Nothing in your refill queue.':'No medications match this view.';
  $('activity').hidden=state.history.length===0;
  $('history-list').replaceChildren(...state.history.slice(0,12).map(h=>{const li=el('li');const t=el('time','',new Intl.DateTimeFormat('en-AU',{timeZone:TIMEZONE,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(h.at)));t.dateTime=h.at;li.append(el('span','',h.text),t);return li;}));
  $('save-status').textContent=demo?'Demo - not saved':storageError?'Storage needs attention':'Stored on this device';
  $('backup-footer').disabled=demo||Boolean(storageError);
  for(const id of ['add-desktop','add-mobile','add-empty'])$(id).disabled=Boolean(storageError&&!demo)||state.medicines.length>=100;
  if(focusedCard&&!sheet.open){
    const card=[...document.querySelectorAll('.medicine')].find(x=>x.dataset.id===focusedCard);
    [...(card?.querySelectorAll('button')||[])].find(x=>x.className===focusedClass)?.focus();
  }
}
function renderSummary(all,low,warnings,pending,day) {
  const box=$('summary');box.replaceChildren();const copy=el('div','summary-copy'),aside=el('div','summary-aside');
  let title,body,large,label;
  if(storageError&&!demo){title='Your data needs attention.';body='Open Settings to export the original data or restore a backup.';large='!';label='check storage';}
  else if(!all.length){title='Keep refills in sight.';body='Your remaining supply, without the mental tally.';large='0';label='medications';}
  else if(warnings.length){title='Check a count date.';body='A saved count is ahead of today. Check your device date, then recount.';large=warnings.length;label='needs review';}
  else if(low.length){title=low.length===1?'One refill to plan.':`${low.length} refills to plan.`;body=pending?`${pending} marked ordered. Stock only changes when a refill is received.`:'These are at your refill threshold. Give yourself some lead time.';large=low.length;label=low.length===1?'in your queue':'in your queue';}
  else{title='You have room to plan.';const next=all.filter(({p})=>p.refillOn).sort((a,b)=>a.p.refillOn.localeCompare(b.p.refillOn))[0];body=next?`Next refill notice: ${dateLabel(next.p.refillOn)}. Based on your daily estimates.`:'Your recorded quantities are above your refill thresholds.';large=all.length;label='in your stack';}
  copy.append(el('h2','',title),el('p','',body));
  if(low.length||warnings.length){copy.append(button('View refill queue','button hero-action',()=>{filter='refill';render();$('inventory-heading').scrollIntoView({block:'start',behavior:'auto'});$('filter-refill').focus();}));}
  if(storageError&&!demo)copy.append(button('Open Settings','button hero-action',openSettings));
  aside.append(el('div','summary-number',large),el('small','',label));box.append(copy,aside);
}
function medicineCard(m,p,day) {
  const card=el('article','medicine');card.dataset.id=m.id;
  const level=p.clockWarning?'low':p.remaining===0?'out':p.needsRefill?'low':m.mode==='manual'?'manual':'ok';card.dataset.status=level;
  const head=el('div','medicine-head'),symbol=el('div','medicine-symbol');symbol.append(icon('pill'));
  const title=el('div','medicine-title');const heading=el('h3','',m.name);heading.id=`medicine-${m.id}`;card.setAttribute('aria-labelledby',heading.id);
  title.append(heading,el('p','medicine-sub',[m.strength,m.mode==='daily'?`${formatNumber(m.dailyUse)} pill${m.dailyUse===1?'':'s'} / day`:'Manually tracked'].filter(Boolean).join(' · ')));
  const statuses=el('div','statuses');statuses.append(el('span',`status ${level}`,p.clockWarning?'Check date':p.remaining===0?'Out of stock':p.needsRefill?'Refill soon':m.mode==='manual'?'Manual count':'In stock'));
  if(m.ordered)statuses.append(el('span','status ordered','Ordered'));
  title.append(statuses);head.append(symbol,title);
  const balance=el('div','medicine-balance');balance.append(el('div',`pill-count${formatNumber(p.remaining).length>5?' long':''}`,formatNumber(p.remaining)),el('div','balance-label',p.clockWarning?'last recorded':m.mode==='daily'?'pills left · estimate':'pills left · recorded'));
  if(m.mode==='daily'&&!p.clockWarning){
    balance.append(el('div','days-label',`${p.daysLeft>=10000?'9,999+':formatNumber(p.daysLeft)} full day${p.daysLeft===1?'':'s'}`));
    const rail=el('div','coverage');rail.setAttribute('role','img');rail.setAttribute('aria-label',`${Math.min(28,p.daysLeft)} of the next 28 days covered, based on your estimate.`);
    for(let i=0;i<28;i++)rail.append(el('span',i<p.daysLeft?'filled':''));balance.append(rail,el('div','coverage-caption','Next 28 days'));
  }else balance.append(el('div','days-label',p.clockWarning?'Check date':'No forecast'));
  let note=p.clockWarning?`Count dated ${dateLabel(m.countedOn)}. Check the date, then recount.`:m.mode==='daily'?`First short day: ${dateLabel(p.firstShortDay)}. Refill notice: ${p.refillOn<=day?'now':dateLabel(p.refillOn)}.`:`Refill notice at ${formatNumber(m.lowCount)} pills. Last count: ${dateLabel(m.countedOn)}.`;
  const actions=el('div','medicine-actions');const update=button('Update stock','stock-button',()=>openStock(m.id));update.append(icon('arrow'));update.setAttribute('aria-label',`Update stock for ${m.name}`);
  const right=el('div','small-actions');const order=button(m.ordered?'Undo ordered':'Mark ordered','text-button',()=>perform(s=>{s.medicines=s.medicines.map(x=>x.id===m.id?{...x,ordered:!m.ordered}:x);return s;},`${m.name}: ${m.ordered?'order mark removed':'marked ordered'}.`));
  order.setAttribute('aria-label',`${m.ordered?'Undo ordered for':'Mark ordered for'} ${m.name}`);
  const edit=button('','edit-button',()=>openMedicine(m.id));edit.append(icon('edit'));edit.setAttribute('aria-label',`Edit ${m.name}`);
  right.append(order,edit);actions.append(update,right);card.append(head,balance,el('p','medicine-note',note),actions);return card;
}

function openMedicine(id=null) {
  const existing=state.medicines.find(m=>m.id===id),day=todayInMelbourne();
  const values=existing?{...existing,quantity:project(existing,day).remaining}:{name:'',strength:'',quantity:'',dailyUse:'',mode:'daily',leadDays:7,lowCount:5,packSize:0};
  const body=openSheet(existing?'Edit medication':'Add medication',existing?'Medication details':'Start with a count');
  const expected=dialogRaw;
  const form=el('form','form');
  const name=field('Medication name','name',{value:values.name,required:true,maxLength:80,placeholder:'Name on the pack'});
  const strength=field('Strength (optional)','strength',{value:values.strength,maxLength:80,placeholder:'As written on the pack'});
  const mode=selector('Tracking method','mode',[['daily','Daily estimate'],['manual','Manual count']],values.mode);
  const q=field('Pills left after today\'s use','quantity',{value:values.quantity,type:'number',required:true,min:0,max:100000,step:.25});
  const daily=field('Pills used per day','dailyUse',{value:values.dailyUse,type:'number',required:values.mode==='daily',min:.25,max:1000,step:.25,help:'Enter your existing routine, not the strength in mg.'});
  const lead=field('Refill notice (days left)','leadDays',{value:values.leadDays,type:'number',required:true,min:0,max:90,step:1});
  const low=field('Refill notice (pills left)','lowCount',{value:values.lowCount,type:'number',required:true,min:0,max:100000,step:.25});
  const pack=field('Usual refill size (optional)','packSize',{value:values.packSize||'',type:'number',min:.25,max:100000,step:.25,help:'Pill count to prefill when you receive a refill.'});
  const dailyRow=row(daily.wrapper,lead.wrapper);const note=el('p','form-note');
  function changeMode(){const isDaily=mode.input.value==='daily';dailyRow.hidden=!isDaily;daily.input.disabled=!isDaily;lead.input.disabled=!isDaily;low.input.disabled=isDaily;daily.input.required=isDaily;lead.input.required=isDaily;low.wrapper.hidden=isDaily;low.input.required=!isDaily;q.wrapper.firstChild.textContent=isDaily?"Pills left after today's use":'Pills currently left';note.textContent=isDaily?`Saving sets today's after-use balance (${dateLabel(day)}). The estimate subtracts your daily use from tomorrow, even if the app stays closed. It does not confirm you took any pills.`:'Manual counts only change when you update them. Use this for variable or as-needed use; no daily forecast is assumed.';}
  mode.input.addEventListener('change',changeMode);changeMode();
  form.append(name.wrapper,strength.wrapper,mode.wrapper,q.wrapper,dailyRow,low.wrapper,pack.wrapper,note,formError());
  const submit=footer(form,existing?'Save changes':'Add medication');
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;submit.disabled=true;
    try {
      const next=validateMedicine({id:existing?.id||crypto.randomUUID(),name:name.input.value,strength:strength.input.value,mode:mode.input.value,
        quantity:Number(q.input.value),dailyUse:mode.input.value==='daily'?Number(daily.input.value):0,leadDays:Number(lead.input.value),lowCount:Number(low.input.value),packSize:pack.input.value===''?0:Number(pack.input.value),countedOn:todayInMelbourne(),ordered:existing?.ordered||false});
      await commit(s=>{if(existing)s.medicines=s.medicines.map(m=>m.id===id?next:m);else s.medicines.push(next);return s;},`${next.name}: ${existing?'details updated':'added to your stack'}.`,expected);closeSheet();
    } catch(e){showError(form,e);}finally{submit.disabled=false;}
  });
  if(existing){const remove=el('div','delete-row');remove.append(button('Remove medication','text-button',()=>openRemove(existing)));form.append(remove);}
  body.append(form);requestAnimationFrame(()=>name.input.focus());
}
function openStock(id) {
  const m=state.medicines.find(x=>x.id===id);if(!m)return;
  const p=project(m);const body=openSheet(m.name,'Update stock');const expected=dialogRaw;
  const summary=el('div','stock-summary');summary.append(el('span','',m.mode==='daily'?'Current estimate':'Recorded balance'),el('strong','',`${formatNumber(p.remaining)} pills`));body.append(summary);
  const form=el('form','form');const opts=[['count','Recount - replace the current balance'],['refill','Refill received - add pills']];if(m.mode==='manual')opts.push(['use','Record pills used - subtract pills']);
  const action=selector('Stock action','action',p.clockWarning?[opts[0]]:opts,'count');
  const amount=field('New pill count','amount',{value:p.remaining,type:'number',required:true,min:0,max:100000,step:.25});
  const note=el('p','form-note');
  function changeAction(){const a=action.input.value;amount.input.min=a==='count'?0:.25;amount.input.value=a==='count'?p.remaining:a==='refill'?(m.packSize||''):'';amount.wrapper.firstChild.textContent=a==='count'?'New pill count':a==='refill'?'Pills received':'Pills used';
    note.textContent=a==='count'?(m.mode==='daily'?"Enter the pills left after today's normal use. This replaces the estimate, with the next daily subtraction tomorrow.":'Enter the pills you can count now. This replaces the recorded balance.'):a==='refill'?'Only add pills you have actually received. This also clears the Ordered label.':'Subtract only the amount used. This updates inventory; it is not a dosing instruction.';}
  action.input.addEventListener('change',changeAction);changeAction();form.append(action.wrapper,amount.wrapper,note,formError());const submit=footer(form,'Save stock');
  form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;submit.disabled=true;
    try{const value=Number(amount.input.value),updated=updateStock(m,action.input.value,value);const message=action.input.value==='refill'?`${m.name}: received ${formatNumber(value)} pills.`:action.input.value==='use'?`${m.name}: ${formatNumber(value)} pills subtracted.`:`${m.name}: recounted to ${formatNumber(value)} pills.`;
      await commit(s=>{s.medicines=s.medicines.map(x=>x.id===id?updated:x);return s;},message,expected);closeSheet();
    }catch(e){showError(form,e);}finally{submit.disabled=false;}});
  body.append(form);requestAnimationFrame(()=>amount.input.focus());
}
function openRemove(m) {
  const body=openSheet('Remove medication?','Confirm removal');const expected=dialogRaw;
  body.append(el('p','confirm-copy',`Remove ${m.name} from your stack? This does not change your prescription. You can undo this stock-list change immediately afterwards.`));
  const form=el('form','form');form.append(formError());const submit=footer(form,'Remove medication');submit.className='button danger';
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await commit(s=>{s.medicines=s.medicines.filter(x=>x.id!==m.id);return s;},`${m.name}: removed from the stack.`,expected);closeSheet();}catch(err){showError(form,err);}finally{submit.disabled=false;}});body.append(form);
}
function downloadText(text,name) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function backup(damaged=false) {
  if(demo){notify('Exit demo to back up your own stack.');return;}
  // Re-read just before export so another open tab cannot make this backup stale.
  const latest=read(storage);
  if(!damaged&&latest.error){notify(latest.error);return;}
  const content=damaged?latest.raw:JSON.stringify(latest.state,null,2);
  if(content===null){notify('There is no stored data to export.');return;}
  const date=todayInMelbourne().replaceAll('-','');const stamp=new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replaceAll(':','');
  downloadText(content,`${date}-Pill-Tracker-${damaged?'Recovery':'Backup'}-${stamp}-Rev00.json`);
  notify('Backup download requested. Keep the file somewhere safe.');
}
function openSettings() {
  const body=openSheet('Settings','Pill-Tracker');
  const appearance=el('section','setting-section');appearance.append(el('h3','','Appearance'));const themes=el('div','theme-choices');themes.setAttribute('role','group');themes.setAttribute('aria-label','Appearance');
  for(const [theme,label]of [['light','Light'],['dark','Dark'],['system','System']]){const b=button(label,'',async()=>{try{await commit(s=>{s.theme=theme;return s;},`Appearance set to ${label.toLowerCase()}.`);for(const x of themes.children)x.setAttribute('aria-pressed',String(x===b));}catch(e){notify(e.message);}});b.setAttribute('aria-pressed',String(state.theme===theme));b.disabled=Boolean(storageError&&!demo);themes.append(b);}appearance.append(themes);body.append(appearance);
  const data=el('section','setting-section');data.append(el('h3','','Your data'),el('p','','Saved in this browser on this device. No account, cloud sync or analytics. Browser storage is not an encrypted vault. A backup contains the names and counts you enter.'));
  const buttons=el('div','settings-buttons');const exp=button('Export backup','button secondary',()=>backup());exp.disabled=demo||Boolean(storageError);const imp=button('Restore backup','button secondary',()=>file.click());imp.disabled=demo;
  const file=el('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.setAttribute('aria-label','Select backup file');
  file.addEventListener('change',async()=>{const f=file.files?.[0];if(!f)return;try{if(f.size>1048576)throw new Error('Choose a JSON backup smaller than 1 MB.');const restored=parseBackup(await f.text());openRestore(restored);}catch(e){error.textContent=e.message;error.hidden=false;error.focus();}finally{file.value='';}});
  const error=formError();buttons.append(exp,imp);if(storageError&&raw!==null)buttons.append(button('Export original data','button secondary',()=>backup(true)));data.append(buttons,file,error,el('p','','Back up after important stock changes. Clearing site data, switching browsers or removing the home-screen app may lose your local stack. Install first, then enter or restore your data.'));body.append(data);
  const install=el('section','setting-section');install.append(el('h3','','On your home screen'));
  if(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone){install.append(el('p','','You are already using the home-screen app.'));}
  else{install.append(el('p','','On iPhone: open this page in Safari, tap More then Share (or Share directly), choose Add to Home Screen, enable Open as Web App if shown, then Add. On Android: open the browser menu and choose Install app or Add to Home screen.'));
    if(installEvent){install.append(button('Install app','button primary',async()=>{const event=installEvent;installEvent=null;try{await event.prompt();await event.userChoice;openSettings();}catch{notify('Use your browser menu to add this app to the home screen.');}}));}}
  install.append(el('p','','Open online once and check the offline status before relying on it without a connection. Refill notices appear inside the app; it does not send background notifications.'));body.append(install);
  const help=el('section','setting-section');help.append(el('h3','','How counts work'),el('p','','Daily estimate: start with your stock after today\'s use. Each later Melbourne calendar day subtracts the daily amount you entered. Recount when actual stock differs.'),el('p','','Manual count: no automatic subtraction. Record pills used or enter a fresh count. Mark ordered is only a label; use Refill received when the pills arrive.'),el('p','','Full days = remaining pills divided by daily use, rounded down. The first short day is the following day. Dates use Australia/Melbourne, including daylight saving.'));
  help.append(el('p','','This is an inventory tool, not a medication reminder or clinical record. Fractional entries describe stock; they do not mean a medicine is suitable for splitting.'));
  body.append(help);
  const demoButton=button(demo?'Exit demo':'Try a fictional demo','button secondary wide',()=>{closeSheet();demo?exitDemo():startDemo();});body.append(demoButton);
}
function openRestore(restored) {
  const body=openSheet('Restore this backup?','Review before replacing');const expected=dialogRaw;
  body.append(el('p','confirm-copy',`This will replace the stack in this browser with ${restored.medicines.length} medication${restored.medicines.length===1?'':'s'} from the backup. Export your current stack first if you need to keep it.`));
  const preview=el('ul','import-preview');for(const m of restored.medicines)preview.append(el('li','',`${m.name}: ${formatNumber(m.quantity)} pills as counted on ${dateLabel(m.countedOn,true)} (${m.mode==='daily'?'daily estimate':'manual'}).`));body.append(preview);
  const form=el('form','form');form.append(formError());const submit=footer(form,'Replace and restore');
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await commit(()=>clone(restored),'Backup restored.',expected,true);closeSheet();}catch(err){showError(form,err);}finally{submit.disabled=false;}});body.append(form);
}
function startDemo() {
  if(demo)return;demoSaved={state:clone(state),raw,storageError};demo=true;storageError=null;
  const day=todayInMelbourne();const base={strength:'Fictional example',countedOn:day,mode:'daily',leadDays:7,lowCount:5,packSize:30,ordered:false};
  state={...emptyState(),theme:demoSaved.state.theme,medicines:[{...base,id:'demo-a',name:'Example A',quantity:6,dailyUse:1},{...base,id:'demo-b',name:'Example B',quantity:18,dailyUse:2,ordered:true},{...base,id:'demo-c',name:'Example C',quantity:42,dailyUse:1},{...base,id:'demo-d',name:'Example D',quantity:12,dailyUse:0,mode:'manual'}]};
  filter='all';search='';$('search').value='';undoRecord=null;$('toast').hidden=true;render();
}
function exitDemo(){if(!demo)return;demo=false;state=demoSaved.state;raw=demoSaved.raw;storageError=demoSaved.storageError;demoSaved=null;undoRecord=null;filter='all';search='';$('search').value='';$('toast').hidden=true;refreshStored();}
$('try-demo').addEventListener('click',startDemo);$('exit-demo').addEventListener('click',exitDemo);
$('settings-button').addEventListener('click',openSettings);$('backup-footer').addEventListener('click',()=>backup());
for(const id of ['add-desktop','add-empty','add-mobile'])$(id).addEventListener('click',()=>openMedicine());
$('filter-all').addEventListener('click',()=>{filter='all';render();});$('filter-refill').addEventListener('click',()=>{filter='refill';render();});
$('search').addEventListener('input',e=>{search=e.target.value;render();});
$('dismiss-toast').addEventListener('click',()=>{$('toast').hidden=true;});
$('undo').addEventListener('click',async()=>{
  if(!undoRecord||busy)return;const record=undoRecord;
  try{await commit(()=>clone(record.before),'Last change undone.',record.expectedRaw);undoRecord=null;$('undo').hidden=true;}catch(e){notify(e.message);refreshStored();}
});
window.addEventListener('storage',event=>{if((event.key===KEY||event.key===null)&&!demo){refreshStored();undoRecord=null;notify(sheet.open?'Another tab changed the stack. Close and reopen this form before saving.':'Stack updated from another tab.');}});
systemTheme.addEventListener('change',()=>{if(state.theme==='system')applyTheme();});
let lastDay=todayInMelbourne();
function resume(){if(!demo){const check=read(storage);if(check.raw!==raw||check.error!==storageError)refreshStored();}const day=todayInMelbourne();if(day!==lastDay){lastDay=day;render();}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});window.addEventListener('focus',resume);setInterval(resume,30000);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;});
window.addEventListener('appinstalled',()=>{installEvent=null;notify('App installed. Use the home-screen icon for your local stack.');});
function offlineStatus(){const controlled=Boolean(navigator.serviceWorker?.controller);$('offline-status').textContent=controlled?(navigator.onLine?'Offline ready':'Offline mode'):(navigator.onLine?'Online only for now':'Offline access not ready');}
window.addEventListener('online',offlineStatus);window.addEventListener('offline',offlineStatus);
$('apply-update').addEventListener('click',()=>{if(sheet.open){notify('Close your form before updating the app.');return;}if(registration?.waiting){reloadRequested=true;registration.waiting.postMessage({type:'SKIP_WAITING'});}});
if('serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.addEventListener('controllerchange',()=>{offlineStatus();if(reloadRequested)window.location.reload();});
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
    registration=reg;offlineStatus();if(reg.waiting)$('update-notice').hidden=false;
    reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)$('update-notice').hidden=false;offlineStatus();});});
  }).catch(()=>{$('offline-status').textContent='Offline access unavailable';});
}else{$('offline-status').textContent='Offline access unavailable';}
render();
