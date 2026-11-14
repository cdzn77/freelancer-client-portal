import settings from "../config/brand.json";
// Public deployment identity. Never put credentials in this file or its JSON source.
const domain = new URL(settings.websiteUrl).hostname.replace(/^www\./, "");
export const brand = { ...settings, websiteUrl: new URL(settings.websiteUrl).origin, domain, wwwDomain: `www.${domain}`, wwwUrl: `https://www.${domain}`, searchProperty: `sc-domain:${domain}` };
