"use client";

import { cn } from "@/lib/cn";
import { renderSlot, type SlotRenderer } from "@/lib/renderSlot";
import { getL } from "@/lib/utils";
import { createLanguageField, type LinkFieldValue } from "@tecof/theme-editor";
import {
  ArrowUpRight,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  Twitter,
  Youtube,
} from "lucide-react";
import { useLocale } from "next-intl";
import Link from "next/link";

type Localized = Array<{ code: string; value: string }>;
type LocalizedLink = Array<{ code: string; value: LinkFieldValue }>;

type LegacyFooterLink = { label?: Localized; href?: LocalizedLink };
type LegacyFooterColumn = { title?: Localized; links?: LegacyFooterLink[] };
type LegacySocial = { label?: string; href?: LocalizedLink; icon?: string };

type FooterProps = {
  className?: string;
  brandSlot?: SlotRenderer;
  contactSlot?: SlotRenderer;
  brandName?: Localized;
  tagline?: Localized;
  address?: Localized;
  phone?: string;
  email?: string;
  copyright?: Localized;
  /** Bağlantı sütunları slot'u — her sütun kendi linksSlot'unu taşıyan bir FooterColumn node'u. */
  columnsSlot?: SlotRenderer;
  /** Sosyal medya slot'u — SocialLink node'ları. */
  socialsSlot?: SlotRenderer;
  /** Eski kayıtlar için array fallback'leri (yalnızca doluysa render edilir). */
  columns?: LegacyFooterColumn[];
  socials?: LegacySocial[];
};

const LEGACY_ICONS: Record<string, typeof Linkedin> = {
  linkedin: Linkedin,
  twitter: Twitter,
  instagram: Instagram,
  youtube: Youtube,
};

const footerColumn = (
  id: string,
  titleTr: string,
  titleEn: string,
  links: Array<{ tr: string; en: string; url: string }>
) => ({
  type: "FooterColumn",
  props: {
    id,
    title: [
      { code: "tr", value: titleTr },
      { code: "en", value: titleEn },
    ],
    linksSlot: links.map((link, idx) => ({
      type: "FooterLink",
      props: {
        id: `${id}-link-${idx + 1}`,
        label: [
          { code: "tr", value: link.tr },
          { code: "en", value: link.en },
        ],
        href: [{ code: "tr", value: { url: link.url, target: "_self" } }],
      },
    })),
  },
});

const FooterRender = (props: Record<string, unknown>) => {
  const locale = useLocale() || "tr";
  const footerProps = props as FooterProps;
  const {
    brandSlot,
    contactSlot,
    columnsSlot,
    socialsSlot,
    columns,
    phone,
    email,
    socials,
  } = footerProps;

  const brandName = getL(footerProps.brandName, locale);
  const tagline = getL(footerProps.tagline, locale);
  const address = getL(footerProps.address, locale);
  const copyright = getL(footerProps.copyright, locale);

  // Eski kayıtlı sayfalar: slot'lar boş gelir, içerik array prop'larındadır.
  const legacyColumns = Array.isArray(columns) && columns.length > 0 ? columns : null;
  const legacySocials = Array.isArray(socials) && socials.length > 0 ? socials : null;

  return (
    <footer className={cn("bg-[#faf8f5] border-t border-gray-200 text-gray-600", footerProps.className)}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Top Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 pt-16 pb-12 sm:pt-20 sm:pb-16">
          {/* Brand Column — büyük serif marka */}
          <div className="lg:col-span-4 space-y-7">
            {brandSlot ? (
              <div className="space-y-4">
                {renderSlot(brandSlot)}
              </div>
            ) : (
              <div>
                <h3
                  className="text-2xl tracking-[0.28em] uppercase text-gray-950"
                  style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                >
                  {brandName}
                </h3>
                {tagline && (
                  <p className="mt-4 text-sm text-gray-500 leading-relaxed max-w-xs">
                    {tagline}
                  </p>
                )}
              </div>
            )}

            {/* Contact Info */}
            {contactSlot ? (
              <div className="space-y-3">
                {renderSlot(contactSlot)}
              </div>
            ) : (
              <div className="space-y-3">
                {address && (
                  <div className="flex items-start gap-3 text-sm">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" strokeWidth={1.5} />
                    <span>{address}</span>
                  </div>
                )}
                {phone && (
                  <a
                    href={`tel:${phone}`}
                    className="flex items-center gap-3 text-sm hover:text-gray-950 transition-colors"
                  >
                    <Phone className="w-4 h-4 text-gray-400 shrink-0" strokeWidth={1.5} />
                    {phone}
                  </a>
                )}
                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-center gap-3 text-sm hover:text-gray-950 transition-colors"
                  >
                    <Mail className="w-4 h-4 text-gray-400 shrink-0" strokeWidth={1.5} />
                    {email}
                  </a>
                )}
              </div>
            )}

            {/* Socials */}
            <div className="pt-1">
              {renderSlot(socialsSlot, { className: "flex gap-2.5" })}
              {!socialsSlot && legacySocials && (
                <div className="flex gap-2.5">
                  {legacySocials.map((social, idx) => {
                    const socialLink = getL(social.href, locale) as LinkFieldValue | undefined;
                    const Icon = social.icon ? LEGACY_ICONS[social.icon] : null;
                    return (
                      <Link
                        key={idx}
                        href={socialLink?.url || "#"}
                        target={socialLink?.target || "_blank"}
                        className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:border-gray-950 hover:text-gray-950 transition-all duration-200"
                        aria-label={social.label}
                      >
                        {Icon && <Icon className="w-4 h-4" strokeWidth={1.5} />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Link Columns */}
          <div className="lg:col-span-8">
            {renderSlot(columnsSlot, {
              className: "grid grid-cols-2 sm:grid-cols-3 gap-8 lg:gap-12",
              minEmptyHeight: 120,
            })}
            {!columnsSlot && legacyColumns && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 lg:gap-12">
                {legacyColumns.map((column, colIdx) => (
                  <div key={colIdx}>
                    <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.2em] mb-5">
                      {getL(column.title, locale)}
                    </h4>
                    <ul className="space-y-3">
                      {column.links?.map((link, linkIdx) => {
                        const lLink = getL(link.href, locale) as LinkFieldValue | undefined;
                        return (
                          <li key={linkIdx}>
                            <Link
                              href={lLink?.url || "#"}
                              target={lLink?.target || "_self"}
                              className="group inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-950 transition-colors duration-200"
                            >
                              {getL(link.label, locale)}
                              <ArrowUpRight className="w-3 h-3 opacity-0 -translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-gray-200 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-400 tracking-wide">{copyright}</p>
          {/* Paket hakkı (removeBranding) olan mağazada gizlenir — bkz. layout body.hide-powered-by */}
          <div data-powered-by className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Powered by</span>
            <span className="font-semibold text-gray-600">Tecof</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export const Footer = {
  label: "Footer",

  fields: {
    brandSlot: {
      type: "slot" as const,
      label: "Marka ve Slogan Alanı",
      allow: ["Logo", "Title", "Paragraph"],
    },
    contactSlot: {
      type: "slot" as const,
      label: "İletişim Bilgileri",
      allow: ["Paragraph", "Button"],
    },
    columnsSlot: {
      type: "slot" as const,
      label: "Bağlantı Sütunları",
      allow: ["FooterColumn"],
    },
    socialsSlot: {
      type: "slot" as const,
      label: "Sosyal Medya Bağlantıları",
      allow: ["SocialLink"],
      orientation: "horizontal" as const,
    },
    copyright: createLanguageField({ label: "Telif Hakkı Metni" }),
  },

  defaultProps: {
    id: "Footer-1",
    brandSlot: [
      {
        type: "Logo",
        props: {
          id: "footer-logo",
          media: [
            {
              _id: "default-logo-svg",
              name: "logo.svg",
              type: "external",
              url: "/logo.svg",
              provider: "external"
            }
          ],
          text: [
            { code: "tr", value: "Tecof" },
            { code: "en", value: "Tecof" },
          ],
          href: [{ code: "tr", value: { url: "/", target: "_self" } }],
        },
      },
      {
        type: "Paragraph",
        props: {
          id: "footer-tagline",
           text: [
            { code: "tr", value: "<p>Doğal malzemeler ve özenli işçilikle tasarlanan zamansız ürünler.</p>" },
            { code: "en", value: "<p>Timeless products designed with natural materials and careful craftsmanship.</p>" },
          ],
          tone: "muted",
          align: "left",
        },
      },
    ] as unknown as SlotRenderer,
    contactSlot: [
      {
        type: "Paragraph",
        props: {
          id: "footer-address",
          text: [
            { code: "tr", value: "<p>İstanbul, Türkiye</p>" },
            { code: "en", value: "<p>Istanbul, Turkey</p>" },
          ],
          tone: "muted",
          align: "left",
        },
      },
    ] as unknown as SlotRenderer,
    columnsSlot: [
      footerColumn("footer-col-company", "Mağaza", "Shop", [
        { tr: "Yeni Gelenler", en: "New Arrivals", url: "/yeni-gelenler" },
        { tr: "Koleksiyon", en: "Collection", url: "/koleksiyon" },
        { tr: "Özel Seri", en: "Limited Edition", url: "/ozel-seri" },
      ]),
      footerColumn("footer-col-solutions", "Kurumsal", "Company", [
        { tr: "Hakkımızda", en: "About Us", url: "/hakkimizda" },
        { tr: "Blog", en: "Blog", url: "/blog" },
        { tr: "İletişim", en: "Contact", url: "/iletisim" },
      ]),
      footerColumn("footer-col-legal", "Yasal", "Legal", [
        { tr: "Gizlilik Politikası", en: "Privacy Policy", url: "#" },
        { tr: "Kullanım Koşulları", en: "Terms", url: "#" },
        { tr: "KVKK", en: "GDPR", url: "#" },
      ]),
    ] as unknown as SlotRenderer,
    socialsSlot: [
      {
        type: "SocialLink",
        props: {
          id: "footer-social-linkedin",
          label: "LinkedIn",
          href: [{ code: "tr", value: { url: "#", target: "_blank" } }],
          icon: "linkedin",
        },
      },
      {
        type: "SocialLink",
        props: {
          id: "footer-social-twitter",
          label: "Twitter",
          href: [{ code: "tr", value: { url: "#", target: "_blank" } }],
          icon: "twitter",
        },
      },
      {
        type: "SocialLink",
        props: {
          id: "footer-social-instagram",
          label: "Instagram",
          href: [{ code: "tr", value: { url: "#", target: "_blank" } }],
          icon: "instagram",
        },
      },
    ] as unknown as SlotRenderer,
    copyright: [
      { code: "tr", value: "© 2024 Tecof. Tüm hakları saklıdır." },
      { code: "en", value: "© 2024 Tecof. All rights reserved." },
    ],
  },

  render: FooterRender,
};

export default Footer;
