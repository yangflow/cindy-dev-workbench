// Run this function with a Playwright page against `npm run preview` only.
async (page) => {
 const base=new URL(page.url()).origin,results=[];
 const check=(value,label)=>{if(!value)throw Error(label);results.push(label);};
 const fixture=async patch=>page.evaluate(async patch=>{const r=await fetch('/fixture',patch?{method:'POST',body:JSON.stringify(patch)}:{});return r.json();},patch);
 const receipt=async text=>{await page.waitForFunction(text=>document.getElementById('notice').textContent.includes(text),text);const box=await page.locator('#notice').boundingBox();const size=page.viewportSize();check(!!box&&box.y>=0&&box.y+box.height<=size.height,'visible receipt: '+text);};
 await fixture({reset:true});
 for(const [theme,width] of [['light',1100],['dark',390],['light',320]]){
  await page.setViewportSize({width,height:700});await page.goto(base+'/?view=workspace&theme='+theme);await page.waitForSelector('.requirement-actions summary');
  await fixture({workerFailure:false,navigationFailure:false,wakeStatus:200});
  const heading=page.locator('.requirement-actions summary').first();await heading.focus();await page.keyboard.press('Enter');check(await page.locator('.requirement-actions details').first().evaluate(e=>e.open),'keyboard opens menu '+theme+'/'+width);
  await page.getByRole('button',{name:'阶段与说明',exact:true}).click();check(await page.locator('#detail').isVisible(),'stage panel '+width);
  await page.getByLabel('工作台说明',{exact:true}).fill('Fictional feedback regression');
  const before=(await fixture()).calls.filter(c=>c.method==='session/edit').length;
  await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('#detail').waitFor({state:'hidden'});await receipt('已保存');check((await fixture()).calls.filter(c=>c.method==='session/edit').length===before+1,'one save '+width);
  await heading.click();await page.getByRole('button',{name:'关联仓库',exact:true}).filter({visible:true}).first().click();await page.getByLabel('分支',{exact:true}).fill('fixture-ui-'+width+'-'+Date.now());await page.getByLabel('Worktree 路径',{exact:true}).fill('/example/worktrees/ui-'+width);
  const prior=(await fixture()).calls.filter(c=>c.method==='association/save').length;
  await page.getByRole('button',{name:'保存关联',exact:true}).click();await page.locator('#detail').waitFor({state:'hidden'});await receipt('已保存');check((await fixture()).calls.filter(c=>c.method==='association/save').length===prior+1,'one association save '+width);
  await page.locator('.requirement-actions').first().getByRole('button',{name:'打开主会话',exact:true}).click();await receipt('已请求打开主会话');
  await page.locator('.requirement-actions').first().getByRole('button',{name:'在 VS Code 打开',exact:true}).click();await receipt('已请求在 VS Code 打开');
  await page.locator('.requirement-actions summary').first().click();await page.locator('.requirement-actions').first().getByRole('button',{name:'同步此需求',exact:true}).click();await receipt('同步完成');
  await page.locator('.repo-more summary').first().click();await page.getByRole('button',{name:'隐藏仓库',exact:true}).click();await receipt('已隐藏仓库');await page.getByRole('button',{name:'恢复隐藏仓库',exact:true}).click();await receipt('已恢复隐藏仓库');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.getByRole('button',{name:'同步此需求',exact:true}).last().click();await receipt('同步完成');check(await page.evaluate(()=>scrollY)>0,'receipt after scrolling '+width);
  await page.getByRole('button',{name:'全部折叠',exact:true}).click();check(await page.locator('.requirement.is-folded').count()===2,'collapse all '+width);await page.locator('.disclose').first().click();check(await page.locator('.requirement.is-folded').count()===1,'expand '+width);
  await page.getByLabel('审阅状态筛选',{exact:true}).selectOption('none');await receipt('筛选结果');await page.getByLabel('审阅状态筛选',{exact:true}).selectOption('');
  await fixture({navigationFailure:true});await page.locator('.requirement-actions').first().getByRole('button',{name:'打开主会话',exact:true}).click();await receipt('宿主拒绝导航');await fixture({navigationFailure:false,workerFailure:true});
  await page.locator('.requirement-actions summary').first().click();await page.locator('.requirement-actions').first().getByRole('button',{name:'同步此需求',exact:true}).click();await receipt('同步未完整完成');
  await page.screenshot({path:'/tmp/workbench-button-evidence/'+theme+'-'+width+'-failure.png'});
  await page.locator('.requirement-actions summary').first().click();await page.locator('.requirement-actions').first().getByRole('button',{name:'阶段与说明',exact:true}).click();await page.screenshot({path:'/tmp/workbench-button-evidence/'+theme+'-'+width+'-panel.png'});await page.keyboard.press('Escape');check(await page.locator('#detail').isHidden(),'Escape closes panel '+width);
  await fixture({workerFailure:false,wakeStatus:503});await page.getByRole('button',{name:'刷新',exact:true}).click();await receipt('HTTP 503');await fixture({wakeStatus:200});
 }
 await page.getByRole('button',{name:'新建任务',exact:true}).click();await page.getByLabel('会话标题',{exact:true}).fill('Fictional empty task');const creates=(await fixture()).calls.filter(c=>c.method==='session/create').length;await page.getByRole('button',{name:'创建空主会话',exact:true}).click();await page.locator('#detail').waitFor({state:'hidden'});await receipt('已创建空主会话');check((await fixture()).calls.filter(c=>c.method==='session/create').length===creates+1,'one empty fixture session');
 await page.clock.install();await page.route('**/wake',()=>{});await page.getByRole('button',{name:'刷新',exact:true}).click({noWaitAfter:true});await page.clock.fastForward(15001);await receipt('唤醒宿主超时');await page.screenshot({path:'/tmp/workbench-button-evidence/wake-timeout.png'});await page.unrouteAll({behavior:'ignoreErrors'});await page.clock.resume();
 return {checks:results.length,results};
}
