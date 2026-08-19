"use client";

import { cn } from "@/lib/cn";
import { renderSlot, type SlotRenderer } from "@/lib/renderSlot";

const COLS_MAP: Record<string, string> = {
  "2": "grid-cols-1 md:grid-cols-2",
  "3": "grid-cols-1 md:grid-cols-3",
  "4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

type FeaturesSectionProps = {
  className?: string;
  columns?: string;
  background?: string;
  contentSlot?: SlotRenderer;
  itemsSlot?: SlotRenderer;
};

export const FeaturesSectionRender = (props: Record<string, unknown>) => {
  const p = props as FeaturesSectionProps;
  const colsClass = COLS_MAP[p.columns || "3"];
  const isDark = p.background === "dark";
  const bgClass = isDark
    ? "bg-gray-950 text-white"
    : p.background === "cream"
      ? "bg-[#faf8f5] text-gray-950"
      : "bg-white text-gray-950";
  const cardClass = isDark
    ? "[&_.group]:border-white/10 [&_.group]:bg-white/95 [&_.group]:shadow-[0_24px_80px_-56px_rgba(0,0,0,0.75)] [&_.group]:ring-white/10 [&_.group:hover]:bg-white"
    : "[&_.group]:border-white/80 [&_.group]:bg-white/90 [&_.group]:shadow-[0_24px_80px_-56px_rgba(17,24,39,0.55)] [&_.group]:ring-gray-950/[0.04] [&_.group:hover]:shadow-[0_30px_90px_-52px_rgba(17,24,39,0.62)]";

  return (
    <section className={cn("relative isolate overflow-hidden py-16 lg:py-24", bgClass, p.className)}>
      <div className={cn("absolute inset-0 -z-10", isDark ? "bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.13),transparent_30%)]" : "bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.14),transparent_32%)]")} />
      <div className="absolute inset-0 -z-10 opacity-[0.26] [background-image:linear-gradient(to_right,rgba(17,24,39,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(17,24,39,0.08)_1px,transparent_1px)] [background-size:84px_84px]" />
      <div className={cn("absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent to-transparent", isDark ? "via-white/15" : "via-gray-200")} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {p.contentSlot ? (
          <div className="mx-auto mb-12 flex max-w-3xl flex-col items-center text-center lg:mb-14">
            {renderSlot(p.contentSlot, {
              className: "flex flex-col items-center gap-4 text-center [&_p]:max-w-2xl",
            })}
          </div>
        ) : null}

        {/* Slot Grid of Card Elements */}
        <div
          className={cn(
            "grid items-stretch gap-5 lg:gap-6 [&_.group]:relative [&_.group]:flex [&_.group]:h-full [&_.group]:min-h-[260px] [&_.group]:flex-col [&_.group]:overflow-hidden [&_.group]:rounded-[28px] [&_.group]:border [&_.group]:p-7 [&_.group]:ring-1 [&_.group]:backdrop-blur-sm [&_.group]:transition-all [&_.group]:duration-300 [&_.group:hover]:-translate-y-1 sm:[&_.group]:p-8",
            colsClass,
            cardClass
          )}
        >
          {renderSlot(p.itemsSlot, {
            className: "contents",
          })}
        </div>
      </div>
    </section>
  );
};

export const FeaturesSection = {
  label: "Özellikler / Değerler Vitrini",
  fields: {
    columns: {
      type: "radio" as const,
      label: "Sütun Sayısı",
      options: [
        { label: "2 Sütun", value: "2" },
        { label: "3 Sütun", value: "3" },
        { label: "4 Sütun", value: "4" },
      ],
    },
    background: {
      type: "select" as const,
      label: "Arka Plan",
      options: [
        { label: "Beyaz", value: "white" },
        { label: "Krem", value: "cream" },
        { label: "Koyu", value: "dark" },
      ],
    },
    contentSlot: {
      type: "slot" as const,
      label: "Başlık ve Açıklama",
      allow: ["Title", "Paragraph", "Spacer", "Divider"],
    },
    itemsSlot: {
      type: "slot" as const,
      label: "Özellik Kartları (Card elementleri yerleştirin)",
      allow: ["Card"],
    },
  },
  defaultProps: {
    id: "FeaturesSection-1",
    columns: "3",
    background: "cream",
    contentSlot: [
      {
        type: "Title",
        props: {
          id: "features-eyebrow",
          text: [
            { code: "tr", value: "Avantajlar" },
            { code: "en", value: "Advantages" },
          ],
          size: "xs",
          align: "center",
          className: "rounded-full border border-gray-200/80 bg-white/80 px-3.5 py-1.5 text-gray-600 shadow-sm shadow-gray-950/[0.03]",
        },
      },
      {
        type: "Title",
        props: {
          id: "features-heading",
          text: [
            { code: "tr", value: "Alışverişi Daha Rahat Hale Getiren Ayrıntılar" },
            { code: "en", value: "Details That Make Shopping Easier" },
          ],
          size: "md",
          align: "center",
          className: "max-w-2xl",
        },
      },
      {
        type: "Paragraph",
        props: {
          id: "features-description",
          text: [
            { code: "tr", value: "Teslimattan ödemeye, iade sürecinden desteğe kadar müşterinin güvenini artıran net ve güçlü servis noktaları." },
            { code: "en", value: "Clear service points that build customer trust, from delivery and payment to returns and support." },
          ],
          tone: "muted",
          align: "center",
          className: "max-w-2xl text-[16px] leading-8",
        },
      },
    ] as unknown as SlotRenderer,
    itemsSlot: [
      {
        type: "Card",
        props: {
          id: "features-card-1",
          className: "gap-5",
          contentSlot: [
            {
              type: "Paragraph",
              props: {
                id: "features-index-1",
                text: [
                  { code: "tr", value: "01" },
                  { code: "en", value: "01" },
                ],
                tone: "normal",
                className: "inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-950 text-[12px] font-medium tracking-[0.16em] text-white shadow-sm shadow-gray-950/20",
              },
            },
            {
              type: "Title",
              props: {
                id: "features-title-1",
                text: [
                  { code: "tr", value: "Hızlı & Sigortalı Teslimat" },
                  { code: "en", value: "Fast & Insured Delivery" },
                ],
                size: "sm",
                align: "left",
                className: "max-w-[16rem]",
              },
            },
            {
              type: "Paragraph",
              props: {
                id: "features-desc-1",
                text: [
                  { code: "tr", value: "Siparişler özenli paketleme, net takip bilgisi ve güvenli teslimat akışıyla müşteriye ulaşır." },
                  { code: "en", value: "Orders reach customers with careful packaging, clear tracking, and a secure delivery flow." },
                ],
                tone: "muted",
                align: "left",
                className: "mt-auto text-[15px] leading-7",
              },
            },
          ],
        },
      },
      {
        type: "Card",
        props: {
          id: "features-card-2",
          className: "gap-5 md:-mt-5",
          contentSlot: [
            {
              type: "Paragraph",
              props: {
                id: "features-index-2",
                text: [
                  { code: "tr", value: "02" },
                  { code: "en", value: "02" },
                ],
                tone: "normal",
                className: "inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-[12px] font-medium tracking-[0.16em] text-white shadow-sm shadow-emerald-950/20",
              },
            },
            {
              type: "Title",
              props: {
                id: "features-title-2",
                text: [
                  { code: "tr", value: "Güvenli Ödeme Akışı" },
                  { code: "en", value: "Secure Payment Flow" },
                ],
                size: "sm",
                align: "left",
                className: "max-w-[16rem]",
              },
            },
            {
              type: "Paragraph",
              props: {
                id: "features-desc-2",
                text: [
                  { code: "tr", value: "SSL koruması, 3D Secure ve açık ödeme adımlarıyla satın alma süreci daha güven verir." },
                  { code: "en", value: "SSL protection, 3D Secure, and clear checkout steps make every purchase feel safer." },
                ],
                tone: "muted",
                align: "left",
                className: "mt-auto text-[15px] leading-7",
              },
            },
          ],
        },
      },
      {
        type: "Card",
        props: {
          id: "features-card-3",
          className: "gap-5",
          contentSlot: [
            {
              type: "Paragraph",
              props: {
                id: "features-index-3",
                text: [
                  { code: "tr", value: "03" },
                  { code: "en", value: "03" },
                ],
                tone: "normal",
                className: "inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-[12px] font-medium tracking-[0.16em] text-white shadow-sm shadow-amber-950/20",
              },
            },
            {
              type: "Title",
              props: {
                id: "features-title-3",
                text: [
                  { code: "tr", value: "Kolay İade & Destek" },
                  { code: "en", value: "Easy Returns & Support" },
                ],
                size: "sm",
                align: "left",
                className: "max-w-[16rem]",
              },
            },
            {
              type: "Paragraph",
              props: {
                id: "features-desc-3",
                text: [
                  { code: "tr", value: "Esnek iade adımları ve hızlı destek iletişimiyle alışveriş sonrası deneyim de güçlü kalır." },
                  { code: "en", value: "Flexible return steps and fast support keep the post-purchase experience strong." },
                ],
                tone: "muted",
                align: "left",
                className: "mt-auto text-[15px] leading-7",
              },
            },
          ],
        },
      },
    ] as unknown as SlotRenderer,
  },
  render: FeaturesSectionRender,
};


export default FeaturesSection;
