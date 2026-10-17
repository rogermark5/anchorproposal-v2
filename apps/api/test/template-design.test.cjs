require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {templateConfigSchema,DESIGN_THEMES,HEADER_ACCENTS,WATERMARKS,SECTION_STYLES,decorationSvg}=require('@anchorproposal/shared');
const {TemplatesService}=require('../dist/templates/templates.service'),{DocumentRendererService}=require('../dist/documents/document-renderer.service');
const {editedDocument}=require('../dist/generations/document-edits'),{bindProfileOutput}=require('../dist/generations/profile-output');
const JSZip=createRequire(require.resolve('docx'))('jszip');
const service=new TemplatesService({}),sample=()=>service.getSamplePreviewContent();
test('Header title visibility respects both the template choice and account settings without changing either',()=>{
 const {applyDocumentDisplay}=require('../dist/generations/document-display');const original={contact:{showJobTitle:false}};
 assert.equal(applyDocumentDisplay(original,{showJobTitle:true}).contact.showJobTitle,false);assert.equal(original.contact.showJobTitle,false);
 assert.equal(applyDocumentDisplay({},{showJobTitle:false}).contact.showJobTitle,false);assert.equal(applyDocumentDisplay({},{showJobTitle:true}).contact.showJobTitle,true);
});
const allSections={order:['projects','summary','experience','education','skills','certifications','headline','expertise'],visibility:{headline:true,expertise:true,projects:true},labels:{projects:'Selected Work',experience:'Career History'},headingAlignment:'right'};
test('Designer contract exposes every reference theme, accent, watermark and section style without dropping new fields',()=>{
 assert.equal(DESIGN_THEMES.length,12);assert.equal(HEADER_ACCENTS.length,16);assert.equal(WATERMARKS.length,14);assert.equal(SECTION_STYLES.length,16);
 for(const accent of HEADER_ACCENTS)for(const watermark of WATERMARKS){const config=templateConfigSchema.parse({pdf:{headerAccent:accent,watermark,sectionStyle:'pill'},experience:{layout:'double',elements:{title:{line:2,align:'right',color:'#123456',bold:false}}},sections:allSections});assert.equal(config.pdf.headerAccent,accent);assert.equal(config.pdf.watermark,watermark);assert.equal(config.experience.elements.title.line,2);assert.equal(config.sections.labels.projects,'Selected Work');}
 assert.throws(()=>templateConfigSchema.parse({experience:{elements:{title:{color:'red; display:none'}}}}));assert.throws(()=>templateConfigSchema.parse({pdf:{watermark:'arbitrary-script'}}));
});
test('Vector decorations are distinct, have no remote resources, and do not interpolate executable colors',()=>{
 const accents=HEADER_ACCENTS.map(a=>decorationSvg(a,'none')),marks=WATERMARKS.map(w=>decorationSvg('none',w));assert.equal(new Set(accents).size,16);assert.equal(new Set(marks).size,14);
 for(const svg of [...accents,...marks]){assert.doesNotMatch(svg,/<script|<foreignObject|href=|https?:\/\/(?!www\.w3\.org)/);assert.match(svg,/viewBox="0 0 612 792"/);const ids=new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));for(const ref of svg.matchAll(/url\(#([^)]+)\)/g))assert.ok(ids.has(ref[1]),'Missing vector reference '+ref[1]);}
 assert.ok(!decorationSvg('top-band','none','"><script>bad</script>').includes('<script>'));
});
test('Every reference style reaches rendered HTML, while headings reorder, rename and hide independently',()=>{
 for(const value of SECTION_STYLES){const html=service.renderPreviewHtml(sample(),{pdf:{sectionStyle:value},sections:allSections});assert.match(html,new RegExp(`class="section-heading style-${value}"`));assert.ok(html.indexOf('data-section="projects"')<html.indexOf('data-section="summary"'));assert.match(html,/Selected Work/);assert.match(html,/Career History/);assert.match(html,/text-align:right/);}
 const html=service.renderPreviewHtml(sample(),{sections:{visibility:{experience:false,projects:false}}});assert.ok(!html.includes('data-section="experience"'));assert.ok(!html.includes('data-section="projects"'));assert.ok(!html.includes('class="page-frame"'));
});
test('Contact and entry fields respect visibility, line, alignment, color and typography without changing content',()=>{
 const content=sample(),before=structuredClone(content),config={contact:{layout:'stacked',elements:{email:{line:2,align:'right',color:'#123456'},phone:{visible:false},location:{line:1,align:'left'}}},experience:{layout:'double',separator:'|',lineGap:100,bulletGap:140,elements:{title:{line:2,align:'right',color:'#654321',italic:true},location:{visible:false},dates:{line:1,align:'left'}}}};
 const html=service.renderPreviewHtml(content,config);assert.match(html,/data-element="email" style="[^"]*color:#123456/);assert.ok(!html.includes(content.contact.phone));assert.match(html,/data-element="title" style="[^"]*font-style:italic;color:#654321/);assert.match(html,/--line-gap:5pt/);assert.match(html,/margin-top:7pt/);assert.deepEqual(content,before);
});
test('Headline, expertise and project formatting reaches Word and HTML with correct page dimensions',async()=>{
 const content=sample(),config={sections:allSections,layout:{pageSize:'A4',headerAlignment:'right',marginLeft:67.2,marginTop:52.8},headline:{fontSize:14,bold:true,italic:false,alignment:'center'},expertise:{layout:'grid',columns:3},projects:{layout:'double',elements:{name:{bold:true,line:1},dates:{align:'right',line:1},url:{visible:false}}},education:{layout:'double'},certifications:{layout:'single'}};
 const html=service.renderPreviewHtml(content,config);assert.match(html,/font-size:14pt/);assert.match(html,/grid-template-columns:repeat\(3,/);assert.ok(!html.includes(content.projects[0].url));
 const xml=await (await JSZip.loadAsync(await new DocumentRendererService(service,{}).renderDocx(content,config))).file('word/document.xml').async('string');assert.match(xml,/SELECTED WORK/);assert.match(xml,/Customer Insights Platform/);assert.match(xml,/w:left="1008"/);assert.match(xml,/w:top="792"/);assert.match(xml,/w:w="11906"/);assert.ok(!xml.includes('w:pgBorders'));assert.ok(!xml.includes(content.projects[0].url));
});
test('Manual projects survive authenticated document edits; model project and identity claims are discarded',()=>{
 const profile={firstName:'Saved',lastName:'Candidate',email:'saved@example.com',experiences:[{company:'Saved Company',title:'Engineer'}],education:[],certifications:[]};
 const original=bindProfileOutput({contact:{name:'Wrong Person'},summary:'Original summary',skills:[{Tools:'React'}],experiences:[{company:'Saved Company',title:'Engineer',bullets:['Built software']}],educations:[],certificates:[],projects:[{name:'Untrusted model claim'}]},profile);
 assert.equal(original.projects,undefined);
 const input={summary:original.summary,skills:original.skills,experiences:[{title:'Engineer',bullets:['Built software']}],educations:[],certificates:[],projects:sample().projects,headline:'Saved candidate professional headline',coreExpertise:['Systems design']};
 const edited=editedDocument(original,profile,input);assert.equal(edited.contact.name,'Saved Candidate');assert.equal(edited.contact.email,'saved@example.com');assert.equal(edited.projects[0].name,'Customer Insights Platform');assert.deepEqual(bindProfileOutput(edited,profile,true).projects,edited.projects);assert.equal(bindProfileOutput(edited,profile).projects,undefined);assert.throws(()=>editedDocument(original,profile,{...input,projects:[{...input.projects[0],url:'javascript:alert(1)'}]}));
});
test('Personal template changes write only the current user customization and preserve the shared catalog',async()=>{
 const original={id:'t',name:'Shared',isPublished:true,configJson:{},archivedAt:null},custom=new Map(),assignments=new Map();
 const db={templateVersion:{findUnique:async()=>original},userTemplateCustomization:{findUnique:async({where})=>custom.get(where.userId_templateVersionId.userId),upsert:async({where,create})=>custom.set(where.userId_templateVersionId.userId,create)},templateAssignment:{updateMany:async()=>{},findUnique:async({where})=>assignments.get(where.userId_templateVersionId.userId),upsert:async()=>{},create:async({data})=>assignments.set(data.userId,data),update:async()=>{}},user:{update:async()=>{}}};
 const templates=new TemplatesService(db),user={id:'a',role:'ADMIN'},before=structuredClone(original);await templates.customize('t',user,{configJson:{pdf:{watermark:'stars',sectionStyle:'boxed'},sections:allSections}});assert.equal((await templates.checkAccess('t',user)).configJson.pdf.watermark,'stars');assert.deepEqual((await templates.checkAccess('t',{id:'b',role:'ADMIN'})).configJson,{});assert.deepEqual(original,before);
});
