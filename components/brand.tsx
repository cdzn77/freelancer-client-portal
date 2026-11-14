import { brand } from "../lib/brand";
export function BrandLogo() {
  return brand.logoPath ? <img className="brand-logo" src={brand.logoPath} alt={brand.name} width="200" height="40" /> : <span className="brand-wordmark">{brand.name}</span>;
}
