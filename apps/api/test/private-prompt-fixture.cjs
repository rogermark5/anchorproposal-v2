const { SettingsService } = require('../dist/settings/settings.service');
function fixture() {
  const actor = { id: 'a1', role: 'ADMIN' };
  const state = { users: [ { ...actor, selectedPromptId: 'private', generationPromptMode: 'profile' }, { id: 'b1', role: 'BIDDER', generationPromptMode: 'user' }, { id: 'master', role: 'MASTER', generationPromptMode: 'user' } ], prompts: [
    { id: 'shared', ownerId: null, content: 'Old shared text' },
    { id: 'match', ownerId: 'a1', name: 'JD Role Match', content: 'Existing role match instructions', experienceTitleMode: 'tailored', documentKind: 'combined' },
    { id: 'private', ownerId: 'a1', name: 'My all-profile prompt', content: 'Private text', isPersonalDefault: true, experienceTitleMode: 'saved', documentKind: 'combined' },
  ].map((p,i) => ({ isPublished: true, archivedAt: null, isPersonalDefault: false, version: i+1, ...p })), preferences: [{ userId: 'a1', profileId: 'p1', resumePromptId: 'match', coverLetterPromptId: null }], failCreate: false };
  const matches = (row,where) => Object.entries(where).every(([k,v]) => k === 'ownerId_sourcePromptId' || k === 'userId_profileId' ? matches(row,v) : row[k] === v);
  const create = async ({data}) => { if(state.failCreate) throw new Error('Database unavailable'); const p={id:'new-'+state.prompts.length, archivedAt:null, isPersonalDefault:false, ...data}; state.prompts.push(p); return p; };
  const prisma = {
    $queryRaw: async () => [],
    promptVersion: { findMany: async ({where}) => state.prompts.filter(p=>matches(p,where)), findFirst: async ({where}) => state.prompts.find(p=>matches(p,where)) || null,
      create, upsert: async ({where,create:data}) => state.prompts.find(p=>matches(p,where)) || create({data}), update: async ({where,data}) => Object.assign(state.prompts.find(p=>matches(p,where)),data),
      updateMany: async ({where,data}) => state.prompts.filter(p=>matches(p,where)).forEach(p=>Object.assign(p,data)) },
    user: {findUnique: async ({where}) => state.users.find(u=>matches(u,where)), update: async ({where,data}) => Object.assign(state.users.find(u=>matches(u,where)),data), updateMany:async()=>{}},
    profile: {findUnique: async()=>({id:'p1',firstName:'Alex',lastName:'Example'})},
    profileGenerationPreference: { findUnique: async ({where}) => state.preferences.find(p=>matches(p,where)), updateMany:async()=>{}, upsert:async({where,create,update}) => { const p=state.preferences.find(p=>matches(p,where)); if(p) return Object.assign(p,update);state.preferences.push(create);return create; } },
  };
  prisma.$transaction=async fn=>{ const before=structuredClone(state); try{return await fn(prisma);}catch(e){Object.assign(state,before);throw e;} };
  return { actor,state,prisma,service:new SettingsService(prisma) };
}
module.exports={fixture};
