import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '../lib/brand';
import { BrandLogo } from '../components/brand';
import { documentTemplate } from '../lib/document-templates';
import { emailMessage, notificationDomain } from '../lib/google-email';
import { discussionReply } from '../lib/discussion-email';
import { verifyBot } from '../lib/verify-bot';
import { brandEvidence } from '../lib/search-intelligence';
async function main() {
  assert.ok(renderToStaticMarkup(<BrandLogo />).includes(brand.name));
  assert.ok(documentTemplate('UX Strategy', 'Contract').scope.includes(brand.name));
  assert.equal(brandEvidence(`Try ${brand.name}`, [brand.websiteUrl]).cited, true);
  assert.equal(brandEvidence(`Try ${brand.name}`, [brand.websiteUrl + '.evil.test']).cited, false);
  const token='12345678-1234-1234-1234-123456789abc';
  const mail=Buffer.from(emailMessage('client@example.test','id',brand.portalUrl,token),'base64url').toString();
  assert.ok(mail.includes(`From: ${brand.name}`)); assert.ok(mail.includes(`@${notificationDomain}>`));
  const reply:any={ id:'r',payload:{headers:[{name:'From',value:'client@example.test'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=example.test;'}, {name:'In-Reply-To',value:`<pms-reply-${token}@${notificationDomain}>`}],mimeType:'text/plain',body:{data:Buffer.from('Approved').toString('base64url')}}};
  assert.equal(discussionReply(reply)?.token,token);
  reply.payload.headers[2].value=`<pms-reply-${token}@${notificationDomain}.evil.test>`;
  assert.equal(discussionReply(reply),null);
  process.env.TURNSTILE_SECRET_KEY='test-only'; process.env.PMS_PUBLIC_URL='https://portal.operator.test';
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({success:true,hostname:'portal.operator.test'});
    await verifyBot('test');
    globalThis.fetch=async()=>Response.json({success:true,hostname:'wrong.example.test'});
    await assert.rejects(verifyBot('test'),/verification/);
  } finally { globalThis.fetch=original; delete process.env.TURNSTILE_SECRET_KEY; delete process.env.PMS_PUBLIC_URL; }
  console.log('White-label rendering, document identity, mail reply domain, citation boundaries, and Turnstile host checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
