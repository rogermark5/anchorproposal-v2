// Local rendering QA only: no application database, AI or external API calls.
require('reflect-metadata');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const puppeteer=require('puppeteer');
const {TemplatesService}=require('../dist/templates/templates.service'),{DocumentRendererService}=require('../dist/documents/document-renderer.service');
const {DESIGN_THEMES,HEADER_ACCENTS,WATERMARKS,SECTION_STYLES,templateConfigSchema}=require('@anchorproposal/shared');
const directory=path.resolve(__dirname,'../../../tmp/template-qa/reference-design');
const poppler=path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin');
const templates=new TemplatesService({}),renderer=new DocumentRendererService(templates,{});
(async()=>{
 await fs.mkdir(directory,{recursive:true});const browser=await puppeteer.launch({headless:'shell',timeout:60000});let checked=0;const results=[];
 try{
  const page=await browser.newPage();await page.setViewport({width:900,height:1200});
  const base={typography:{bodyFont:'Arial',headingFont:'Arial',baseFontSize:10,lineHeight:1.3,nameSize:22,headingSize:11},layout:{marginTop:52.8,marginBottom:52.8,marginLeft:67.2,marginRight:67.2,sectionSpacing:13,headerAlignment:'center'},contact:{layout:'stacked',elements:{email:{line:1,align:'center'},phone:{line:1,align:'center'},location:{line:2,align:'center'},linkedin:{line:2,align:'center'}}},experience:{layout:'double'},education:{layout:'double'},certifications:{layout:'single'},projects:{layout:'double'},sections:{order:['summary','experience','education','skills','certifications','headline','expertise','projects'],visibility:{headline:true,expertise:true,projects:true}}};
  const measure=async(label,config,content=templates.getSamplePreviewContent())=>{
    const html=templates.renderPreviewHtml(content,config);await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
    const measurement=await page.evaluate(()=>{
      const sheet=document.querySelector('.sheet').getBoundingClientRect(),paper=document.querySelector('.page').getBoundingClientRect();
      const overflow=[...document.querySelectorAll('.sheet *')].filter(node=>{const b=node.getBoundingClientRect();return b.width&&(b.left<sheet.left-1||b.right>sheet.right+1);}).map(node=>({tag:node.tagName,cls:node.className}));
      return {overflow,left:sheet.left-paper.left,right:paper.right-sheet.right,sections:document.querySelectorAll('[data-section]').length};
    });assert.deepEqual(measurement.overflow,[],label);assert.ok(measurement.left>=28&&measurement.right>=28,label+' margins');checked++;return {html,measurement};
  };
  for(const accent of HEADER_ACCENTS)await measure('accent '+accent,{...base,pdf:{headerAccent:accent}});
  for(const watermark of WATERMARKS)await measure('watermark '+watermark,{...base,pdf:{watermark}});
  for(const sectionStyle of SECTION_STYLES)await measure('section '+sectionStyle,{...base,pdf:{sectionStyle}});
  const cases=DESIGN_THEMES.map(theme=>({name:theme.id,config:{...base,colors:{accent:theme.color},pdf:{headerAccent:theme.accent,watermark:theme.watermark,sectionStyle:theme.section}}}));
  cases.push({name:'custom-single',config:{...base,experience:{layout:'single',lineGap:0,bulletGap:100,separator:'|',elements:{company:{line:1,align:'left',color:'#126650'},dates:{line:1,align:'right',italic:true},location:{visible:false},jobType:{visible:false}}},pdf:{headerAccent:'double-corner',watermark:'dot-scatter',sectionStyle:'dot'}}});
  cases.push({name:'custom-double',config:{...base,experience:{layout:'double',lineGap:100,bulletGap:140,separator:'•',elements:{title:{line:1,align:'left',bold:true},company:{line:2,align:'left'},dates:{line:1,align:'right'},jobType:{line:2,align:'right'}}},styles:{headingLineStyle:'full',headingLineColor:'#1e3a5f',headingLineThickness:8,headingLineSpacing:60},pdf:{headerAccent:'ribbon-tab',watermark:'concentric-rings',sectionStyle:'square'}}});
  const long=templates.getSamplePreviewContent();long.summary=long.summary.repeat(2);long.experiences=Array.from({length:8},(_,i)=>({...long.experiences[i%2],title:'Senior Platform Engineer '+(i+1),bullets:Array.from({length:5},(_,j)=>`Achievement ${i+1}.${j+1}: Designed reliable distributed services with automated testing, observability and measurable improvements for customer-facing systems.`)}));
  cases.push({name:'long-a4',config:{...base,layout:{...base.layout,pageSize:'A4'},pdf:{headerAccent:'corner-frame',watermark:'leaves',sectionStyle:'chevron'}},content:long});
  for(const item of cases){
    const content=item.content||templates.getSamplePreviewContent(),{html,measurement}=await measure(item.name,item.config,content),file=path.join(directory,item.name+'.pdf');
    await fs.writeFile(file,await renderer.renderPdf(html,item.config,browser));await fs.writeFile(path.join(directory,item.name+'.docx'),await renderer.renderDocx(content,item.config));
    const render=spawnSync(path.join(poppler,'pdftoppm.exe'),['-f','1','-singlefile','-scale-to','1000','-png',file,path.join(directory,item.name)],{windowsHide:true,encoding:'utf8'});assert.equal(render.status,0,render.stderr);
    if(DESIGN_THEMES.some(theme=>theme.id===item.name)){
      const pixels=await page.evaluate(async source=>{const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);const rgba=context.getImageData(0,0,image.width,40).data;let ink=0;for(let i=0;i<rgba.length;i+=4)if(Math.min(rgba[i],rgba[i+1],rgba[i+2])<245)ink++;return ink;},'data:image/png;base64,'+(await fs.readFile(path.join(directory,item.name+'.png'))).toString('base64'));
      assert.ok(pixels>4,item.name+' decorative artwork must survive PDF printing outside the text margins');
    }
    const info=spawnSync(path.join(poppler,'pdfinfo.exe'),[file],{windowsHide:true,encoding:'utf8'});assert.equal(info.status,0,info.stderr);const pages=Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);assert.ok(pages>0);if(item.name==='long-a4')assert.ok(pages>=3);
    results.push({name:item.name,pages,...measurement});console.log('PASS PDF/DOCX '+item.name+' ('+pages+' pages)');
  }
  await page.setViewport({width:1600,height:2200});const cards=await Promise.all(cases.filter(c=>c.name!=='long-a4').map(async item=>`<figure><img src="data:image/png;base64,${(await fs.readFile(path.join(directory,item.name+'.png'))).toString('base64')}"/><figcaption>${item.name}</figcaption></figure>`));
  await page.setContent('<html><style>body{margin:0;padding:20px;background:#e2e8f0;font:18px Arial}main{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}figure{margin:0}img{width:100%;display:block;box-shadow:0 3px 12px #9ca3af}figcaption{text-align:center;margin:8px}</style><main>'+cards.join('')+'</main></html>');await page.screenshot({path:path.join(directory,'gallery.png'),fullPage:true});
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({layoutChecks:checked,pdfs:results.length,results},null,2));console.log(JSON.stringify({layoutChecks:checked,pdfs:results.length}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
