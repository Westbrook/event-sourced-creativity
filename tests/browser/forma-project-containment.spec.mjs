import {test,expect,openForma} from './fixtures.mjs';
import {syntheticNetworkEnabled} from './helpers/synthetic-network.mjs';
import {projectContainmentMessage as message} from '../../src/components/design-system/locales/project-containment-messages.ts';
for(const locale of ['en','ar'])test.describe('Project containment '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('Native project hierarchy control makes only explicit synthetic moves in '+locale,async({page,context,baseURL,geometry},info)=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  let parent=null,generation=0,reads=0;const writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/projects/containment*',async route=>{
   const request=route.request();expect(new URL(request.url()).origin).toBe(new URL(baseURL).origin);
   if(request.method()==='GET'){reads++;return route.fulfill({json:{version:'project-containment-v1',projectId:'project-atmosphere',revision:'sha256:'+String(generation).repeat(64),ancestors:parent?[parent]:[],ancestryComplete:true,parentId:parent,candidates:['synthetic-parent'],canReparent:true,accessInherited:false}});}
   expect(request.method()).toBe('PATCH');const body=request.postDataJSON();expect(body).toEqual({projectId:'project-atmosphere',parentId:body.parentId,revision:'sha256:'+String(generation).repeat(64)});
   expect([null,'synthetic-parent']).toContain(body.parentId);writes.push(body);parent=body.parentId;generation++;
   return route.fulfill({json:{version:'project-containment-v1',saved:true,refreshRequired:true}});
  });
  await openForma(page,context,geometry,'/projects',info);
  const control=page.locator('forma-project-containment').first();await expect(control).toBeVisible();expect(reads).toBe(0);expect(writes).toEqual([]);
  await control.getByRole('button',{name:message(locale,'open'),exact:true}).click();
  const select=control.getByRole('combobox',{name:message(locale,'parent'),exact:true});await expect(select).toBeVisible();
  const submit=control.getByRole('button',{name:message(locale,'save'),exact:true});await expect(submit).toBeDisabled();
  await select.selectOption('synthetic-parent');expect(writes).toEqual([]);await expect(submit).toBeEnabled();await submit.click();
  await expect(control.getByRole('status')).toHaveText(message(locale,'saved'));expect(writes).toHaveLength(1);
  await expect(select).toHaveValue('synthetic-parent');await expect(submit).toBeDisabled();
  await expect(control.getByRole('list',{name:message(locale,'path')})).toBeVisible();
  await control.scrollIntoViewIfNeeded();await page.screenshot({path:'.wrangler/memory-containment-'+locale+'.png'});
  const overflow=await control.evaluate(element=>element.scrollWidth>element.clientWidth+1);expect(overflow).toBe(false);
  await select.selectOption('');await submit.click();await expect(select).toHaveValue('');expect(writes).toHaveLength(2);
  await page.evaluate(()=>window.dispatchEvent(new Event('forma-authorization-changed')));
  await expect(control.getByRole('combobox')).toHaveCount(0);await expect(control.getByRole('status')).toHaveText(message(locale,'expired'));expect(writes).toHaveLength(2);
  await control.getByRole('button',{name:message(locale,'close'),exact:true}).click();await expect(select).toHaveCount(0);
  expect(errors).toEqual([]);
 });
 test('A failed move requires fresh structure before another attempt in '+locale,async({page,context,baseURL,geometry},info)=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);let writes=0;
  await context.route('**/api/projects/containment*',async route=>{
   if(route.request().method()==='PATCH'){writes++;return route.fulfill({status:503,json:{error:'containment_commit_unconfirmed'}});}
   return route.fulfill({json:{version:'project-containment-v1',projectId:'project-atmosphere',revision:'sha256:'+'a'.repeat(64),ancestors:[],ancestryComplete:true,parentId:null,candidates:['synthetic-parent'],canReparent:true,accessInherited:false}});
  });
  await openForma(page,context,geometry,'/projects',info);const control=page.locator('forma-project-containment').first();
  await control.getByRole('button',{name:message(locale,'open'),exact:true}).click();
  await control.getByRole('combobox').selectOption('synthetic-parent');await control.getByRole('button',{name:message(locale,'save'),exact:true}).click();
  await expect(control.getByRole('status')).toHaveText(message(locale,'uncertain'));await expect(control.getByRole('combobox')).toHaveCount(0);expect(writes).toBe(1);
  await control.getByRole('button',{name:message(locale,'refresh'),exact:true}).click();await expect(control.getByRole('combobox')).toHaveValue('');expect(writes).toBe(1);
 });
});
