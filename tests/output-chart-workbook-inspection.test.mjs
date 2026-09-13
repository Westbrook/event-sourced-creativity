import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectOutputAsset } from '../src/model/output-asset-inspection.ts';
import { presentationEntries, zip } from './output-asset-fixtures.mjs';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const T = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const chartPath = 'ppt/slides/charts/chart1.xml';
const workbookPath = 'ppt/embeddings/chart-data.xlsx';
const rels = value => `<Relationships xmlns="${P}">${value}</Relationships>`;
const rel = (kind, target, id='rId1', extra='') => `<Relationship Id="${id}" Type="${R}/${kind}" Target="${target}"${extra}/>`;
function workbookParts() {
  return [
    {name:'[Content_Types].xml',content:`<Types xmlns="${T}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${XLSX}.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`},
    {name:'_rels/.rels',content:rels(rel('officeDocument','xl/workbook.xml'))},
    {name:'xl/workbook.xml',content:`<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Chart Data" sheetId="1" r:id="rId1"/></sheets></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',content:rels(rel('worksheet','worksheets/sheet1.xml'))},
    {name:'xl/worksheets/sheet1.xml',content:`<worksheet xmlns="${S}"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Category</t></is></c><c r="B1" t="inlineStr"><is><t>Score</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Context</t></is></c><c r="B2"><v>85.75</v></c></row></sheetData></worksheet>`},
  ];
}
function chartPackage({inner=workbookParts(), compressed=false, innerBytes, edit}={}) {
  const entries=presentationEntries();
  entries[0].content=entries[0].content.replace('</Types>',`<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/${workbookPath}" ContentType="${XLSX}"/></Types>`);
  entries.push({name:'ppt/slides/_rels/slide1.xml.rels',content:rels(rel('chart','charts/chart1.xml'))},
    {name:chartPath,content:`<c:chartSpace xmlns:c="${C}" xmlns:r="${R}"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>'Chart Data'!$A$2:$A$2</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>'Chart Data'!$B$2:$B$2</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`},
    {name:'ppt/slides/charts/_rels/chart1.xml.rels',content:rels(rel('package','../../embeddings/chart-data.xlsx'))},
    {name:workbookPath,content:innerBytes??zip(inner,{compressed})});
  edit?.(entries); return zip(entries,{compressed});
}
const reject = async bytes => {const result=await inspectOutputAsset(bytes,'deck.pptx');assert.notEqual(result.status,'inspected');assert.deepEqual(result.facts,{});assert.ok(result.errors.length);};
test('native charts accept only bounded literal workbooks, stored and compressed',async()=>{
  for(const compressed of [false,true]) {const result=await inspectOutputAsset(chartPackage({compressed}),'deck.pptx');assert.equal(result.status,'inspected',result.errors.join(','));assert.equal(result.facts.slideCount,2);assert.ok(result.checks.includes('literal-chart-workbook-inspection'));}
});
test('embedded workbook CRC, paths, aliases, extra parts and expansion remain checked',async()=>{
  const corrupt=zip(workbookParts());corrupt[31]^=1;await reject(chartPackage({innerBytes:corrupt}));
  for(const name of ['../escape.xml','xl/WORKBOOK.xml','xl/vbaProject.bin','xl/externalLinks/externalLink1.xml','xl/embeddings/other.xlsx'])await reject(chartPackage({inner:[...workbookParts(),{name,content:'bad'}]}));
  const bomb=zip(workbookParts(),{compressed:true});const view=new DataView(bomb.buffer);const central=view.getUint32(bomb.length-6,true);view.setUint32(central+24,200000000,true);await reject(chartPackage({innerBytes:bomb}));
});
test('workbook formulas, executable features, foreign namespaces and nonliteral cells are rejected',async()=>{
  for(const mutation of [
    value=>value.replace('<v>85.75</v>','<f>WEBSERVICE("https://example.test")</f><v>85.75</v>'),
    value=>value.replace('</worksheet>','<externalReferences/></worksheet>'),
    value=>value.replace('</worksheet>','<definedNames/></worksheet>'),
    value=>value.replace('</worksheet>','<extLst/></worksheet>'),
    value=>value.replace('<v>85.75</v>','<v>NaN</v>'),
    value=>value.replace('<c r="B2">','<c r="B2" t="str">'),
    value=>value.replace('<v>85.75</v>','<v xmlns="https://evil.test">85.75</v>'),
  ]) {const inner=workbookParts();inner[4].content=mutation(inner[4].content);await reject(chartPackage({inner}));}
  const entity=workbookParts();entity[4].content='<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+entity[4].content;await reject(chartPackage({inner:entity}));
});
test('chart formulas cannot escape the inspected literal workbook, including CDATA and entities',async()=>{
  for(const formula of ["'[other.xlsx]Chart Data'!$A$2",'SUM(A1:A2)',"'Wrong Sheet'!$A$2", "'Chart Data'!$A$999", "'Chart Data'!$A$2:$A$1", "'Chart Data'!$A$1:$B$2", "'Chart Data'!$A$2<c:v/>", "cmd|'/c calc'!A1",'<![CDATA[https://example.test]]>','&#91;book&#93;Sheet!$A$1'])await reject(chartPackage({edit:entries=>{const chart=entries.find(e=>e.name===chartPath);chart.content=chart.content.replace("'Chart Data'!$A$2:$A$2",formula);}}));
  await reject(chartPackage({edit:entries=>{const chart=entries.find(e=>e.name===chartPath);chart.content=chart.content.replace('autoUpdate val="0"','autoUpdate val="1"');}}));
});
test('chart reference work is bounded across repeated formulas',async()=>{
  await reject(chartPackage({edit:entries=>{
    const chart=entries.find(e=>e.name===chartPath);
    chart.content=chart.content.replace('</c:plotArea>', `<c:numRef><c:f>'Chart Data'!$B$2</c:f></c:numRef>`.repeat(4096)+'</c:plotArea>');
  }}));
});
test('chart and package relationships must be internal and bound to the right parts and IDs',async()=>{
  for(const mutate of [
    entries=>{entries.find(e=>e.name.endsWith('chart1.xml.rels')).content=rels(rel('package','https://example.test/data.xlsx','rId1',' TargetMode="External"'));},
    entries=>{entries.find(e=>e.name.endsWith('slide1.xml.rels')).content=rels(rel('chart','https://example.test/chart.xml','rId1',' TargetMode="External"'));},
    entries=>{entries.find(e=>e.name===chartPath).content=entries.find(e=>e.name===chartPath).content.replace('r:id="rId1"','r:id="missing"');},
    entries=>{entries.find(e=>e.name.endsWith('chart1.xml.rels')).content=rels(rel('package','../../embeddings/chart-data.xlsx')+rel('package','../../embeddings/chart-data.xlsx'));},
    entries=>{entries.find(e=>e.name.endsWith('slide1.xml.rels')).content=rels(rel('package','../embeddings/chart-data.xlsx'));},
    entries=>{entries[0].content=entries[0].content.replace(`ContentType="${XLSX}"`,'ContentType="application/xml"');},
  ])await reject(chartPackage({edit:mutate}));
});
test('embedded data cannot use arbitrary workbook relationships or declared macro content',async()=>{
  for(const index of [0,1,2,3]) {const inner=workbookParts();inner[index].content=index===0?inner[index].content.replace('sheet.main+xml','sheet.macroEnabled.main+xml'):index===2?inner[index].content.replace('r:id="rId1"','r:id="missing"'):inner[index].content.replace('/relationships/','/evil/');await reject(chartPackage({inner}));}
});
