require('reflect-metadata');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const {DocumentRendererService}=require('../dist/documents/document-renderer.service');const {TemplatesService}=require('../dist/templates/templates.service');
const load=createRequire(require.resolve('docx'));const JSZip=load('jszip');
(async()=>{
 const dir=path.resolve('../../tmp/generation-safety-ui');fs.mkdirSync(dir,{recursive:true});const files=new Map();
 const renderer=new DocumentRendererService(new TemplatesService({}),{saveFile:async(_a,_g,name,data)=>{files.set(name,data);const location=path.join(dir,name);fs.writeFileSync(location,data);return location;}});
 const cover={greeting:'Dear Hiring Manager,',paragraphs:['The Backend Engineer position at Hiring Co aligns with my Java service development experience.','I built tested APIs, documented integrations and improved reliability with targeted automated tests. These contributions relate directly to your engineering requirements.','I welcome the opportunity to discuss how I could contribute to your team.\nSincerely,\nWrong name\nSincerely,'],closing:'Sincerely,\nSincerely,',signatureName:'Wrong name',company:'Hiring Co',jobTitle:'Backend Engineer',date:'2026-10-12',contact:{name:'Jason Glenn',title:'Software Engineer',email:'jason@example.com',phone:'555-0100',address:'Seattle, WA'}};
 const result=await renderer.renderCoverLetter('qa','qa',cover,'professional-cover-letter',{},['PDF','DOCX']);assert.equal(result.length,2);
 const pdf=files.get('professional-cover-letter_CoverLetter.pdf');assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.ok(pdf.length>5000);
 const zip=await JSZip.loadAsync(files.get('professional-cover-letter_CoverLetter.docx'));const xml=await zip.file('word/document.xml').async('string');
 for(const value of ['Jason Glenn','jason@example.com','555-0100','Seattle, WA','Hiring Co','Backend Engineer'])assert.ok(xml.includes(value));
 assert.ok(xml.includes('October 12, 2026'));
 assert.equal(xml.split('Sincerely,').length,2);assert.ok(!xml.includes('Wrong name'));assert.ok(!xml.includes('<w:pgBorders'));
 console.log('PASS professional PDF and DOCX exports include the saved contact header and exactly one signoff.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
