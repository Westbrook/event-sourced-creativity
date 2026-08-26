import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory=dirname(fileURLToPath(import.meta.url));
const root=resolve(directory,"..");
const output=resolve(root,"outputs/slideshow-pdf-fidelity");
const args=process.argv.slice(2);
const argument=(name)=>{const index=args.indexOf(name);return index<0?null:args[index+1]??null;};
const packageRoot=argument("--modules");
const origin=argument("--url")??"http://localhost:5173";
const quick=args.includes("--quick");
const require=createRequire(import.meta.url);

const resolvePackage=(name)=>{
  try{return require.resolve(name,packageRoot?{paths:[packageRoot]}:undefined);}
  catch{throw new Error(`Install ${name}, or pass --modules /path/to/a/node_modules directory containing browser-comparison dependencies.`);}
};

const playwrightModule=await import(pathToFileURL(resolvePackage("playwright")).href);
const pngModule=await import(pathToFileURL(resolvePackage("pngjs")).href);
const { chromium }=playwrightModule.default??playwrightModule;
const { PNG }=pngModule.default??pngModule;
const { default:pixelmatch }=await import(pathToFileURL(resolvePackage("pixelmatch")).href);

const base={style:"nocturne",layout:"split",visual:"bars"};
const reported={style:"editorial",layout:"cover",visual:"diagram",content:"format-question",pages:7,via:"deck"};
const cases=quick?[reported]:[
  reported,
  ...["gallery","editorial","nocturne","field-notes"].map((style)=>({...base,style})),
  ...["cover","statement","columns","metric","timeline","closing"].map((layout)=>({...base,layout})),
  ...["hero-type","metric","timeline","diagram","color-field"].map((visual)=>({...base,visual})),
  {...base,layout:"statement",visual:"none"},
  {...base,footer:"hidden"},
  {...base,custom:"palette"},
  {...base,contrast:"low"},
];

await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1100,height:700},deviceScaleFactor:2});
const page=await context.newPage();
const failures=[];

try{
  await page.goto(`${origin}/tests/presentation-pdf.fixture.html`,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>typeof window.configurePresentationPdfFixture==="function",null,{timeout:15_000});
  for(const entry of cases){
    const name=Object.values(entry).join("-");
    const screenshot=resolve(output,`browser-${name}.png`);
    const pdf=resolve(output,`${name}.pdf`);
    const prefix=resolve(output,`pdf-${name}`);
    const diff=resolve(output,`diff-${name}.png`);

    await page.evaluate((configuration)=>window.configurePresentationPdfFixture(configuration),entry);
    const slides=page.locator(".presentation-slide:visible");
    const slide=slides.first();
    await slide.waitFor({state:"visible"});
    await page.evaluate(()=>document.fonts.ready);
    const actualPresentation=await slide.evaluate((element)=>({classes:element.className,text:element.innerText,foreground:getComputedStyle(element).color,accent:getComputedStyle(element).getPropertyValue("--slide-accent").trim()}));
    if(!actualPresentation.classes.includes(`style-${entry.style}`)||!actualPresentation.classes.includes(`layout-${entry.layout}`))throw new Error(`${name}: the selected style or layout was not applied.`);
    if(entry.visual==="none"&&!actualPresentation.classes.includes("no-visual"))throw new Error(`${name}: an incomplete visual should not create an aside.`);
    if(entry.footer==="hidden"&&actualPresentation.text.includes("CAFÉ"))throw new Error(`${name}: the hidden deck footer remained visible.`);
    if(entry.custom&&!actualPresentation.accent.includes("#47d6bc"))throw new Error(`${name}: the custom slide palette was not retained.`);
    if(entry.contrast==="low"&&actualPresentation.foreground!=="rgb(255, 255, 255)")throw new Error(`${name}: the accessibility-adjusted foreground was not preserved.`);
    if(args.includes("--debug")){
      const diagnostics=await page.evaluate(()=>{
        const heading=document.querySelector(".presentation-slide h3"),style=getComputedStyle(heading),range=document.createRange();
        range.selectNodeContents(heading);
        const context=document.createElement("canvas").getContext("2d");
        const measure=(family)=>{context.font=`${style.fontWeight} ${style.fontSize} ${family}`;return context.measureText(heading.textContent).width;};
        const bars=Array.from(document.querySelectorAll(".presentation-visual-bars,.presentation-visual-bars > div,.presentation-visual-bars small")).map((element)=>({tag:element.tagName,rect:element.getBoundingClientRect().toJSON(),font:getComputedStyle(element).font,lineHeight:getComputedStyle(element).lineHeight,gap:getComputedStyle(element).gap,rows:getComputedStyle(element).gridTemplateRows}));
        return{font:style.font,family:style.fontFamily,letterSpacing:style.letterSpacing,renderedWidth:range.getBoundingClientRect().width,faces:Array.from(document.fonts).map((face)=>({family:face.family,weight:face.weight,status:face.status})),widths:{system:measure("system-ui"),apple:measure("-apple-system"),arial:measure("Arial"),helvetica:measure("Helvetica"),manrope:measure("Manrope"),sans:measure("sans-serif")},bars};
      });
      console.log(JSON.stringify(diagnostics));
    }
    if(entry.via==="deck"){
      await page.getByRole("button",{name:"Export"}).click();
      const [download]=await Promise.all([
        page.waitForEvent("download",{timeout:60_000}),
        page.getByRole("button",{name:"Download PDF"}).click(),
      ]);
      await download.saveAs(pdf);
      const pageInfo=execFileSync("pdfinfo",[pdf],{encoding:"utf8"});
      if(!new RegExp(`^Pages:\\s+${entry.pages}$`,"m").test(pageInfo))throw new Error(`${name}: the downloaded PDF did not retain all ${entry.pages} slides.`);
    }else{
      await page.getByRole("button",{name:"Export visual fidelity fixture"}).click();
      await page.waitForFunction(()=>document.querySelector("#status")?.textContent!=="Rendering…",null,{timeout:15_000});
      const state=await page.evaluate(()=>({status:document.querySelector("#status")?.textContent??"",pdf:document.querySelector("#pdf-output")?.textContent??""}));
      if(!state.pdf)throw new Error(`${name}: ${state.status}`);
      await writeFile(pdf,Buffer.from(state.pdf,"base64"));
    }

    const pageCount=entry.via==="deck"?entry.pages:1;
    for(let index=0;index<pageCount;index+=1){
      const suffix=index?`-page-${index+1}`:"";
      const browserImage=screenshot.replace(/\.png$/,`${suffix}.png`);
      const exportedPrefix=`${prefix}${suffix}`;
      const diffImage=diff.replace(/\.png$/,`${suffix}.png`);
      await slides.nth(index).screenshot({path:browserImage,animations:"disabled"});
      execFileSync("pdftoppm",["-f",String(index+1),"-singlefile","-r","144","-png",pdf,exportedPrefix]);

      const actual=PNG.sync.read(await readFile(browserImage));
      const exported=PNG.sync.read(await readFile(`${exportedPrefix}.png`));
      if(actual.width!==exported.width||actual.height!==exported.height)throw new Error(`${name}${suffix}: browser and PDF dimensions differ (${actual.width}×${actual.height} vs. ${exported.width}×${exported.height}).`);

      const comparison=new PNG({width:actual.width,height:actual.height});
      const changed=pixelmatch(actual.data,exported.data,comparison.data,actual.width,actual.height,{threshold:.1,includeAA:false});
      const ratio=changed/(actual.width*actual.height);
      await writeFile(diffImage,PNG.sync.write(comparison));
      console.log(`${name}${suffix}: ${(ratio*100).toFixed(3)}% visually different (${changed} pixels)`);
      if(ratio>.0125)failures.push({name:`${name}${suffix}`,ratio,changed});
    }
  }

  await page.evaluate(async(configuration)=>{
    await window.configurePresentationPdfFixture({...configuration,pages:1});
    window.CompressionStream=undefined;
  },reported);
  let unexpectedDownload=false;
  page.on("download",()=>{unexpectedDownload=true;});
  await page.getByRole("button",{name:"Export"}).click();
  await page.getByRole("button",{name:"Download PDF"}).click();
  const failure=page.locator('.presentation-deck-export-status[data-export-stage="failed"]');
  await failure.waitFor({state:"visible",timeout:15_000});
  if(!await failure.getByRole("button",{name:"Retry"}).count())throw new Error("The failed capture did not expose a usable retry action.");
  if(!(await failure.innerText()).includes("The PDF could not be prepared. Please try again."))throw new Error("The failed capture did not explain the export failure accurately.");
  if(unexpectedDownload)throw new Error("A failed high-fidelity capture downloaded an incompatible PDF.");
  console.log("Verified failed captures never download an incompatible PDF.");
}finally{
  await browser.close();
}

if(failures.length){
  throw new Error(`${failures.length} slideshow PDF comparison${failures.length===1?"":"s"} exceeded the 1.25% visual-difference budget.`);
}

console.log(`Verified ${cases.length} slideshow appearance${cases.length===1?"":"s"} against losslessly rendered PDF pages.`);
