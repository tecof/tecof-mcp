"use client";

/**
 * ProcessSteps — numaralı, sıralı süreç adımları (üretim akışı, başvuru adımları…).
 *
 * ── Veri modeli: ARRAY (slot DEĞİL) ─────────────────────────────────────────
 * Adımlar `steps` array alanında tutulur ve görünüm bu dosyada açıkça yazılır.
 * Önceden adımlar jenerik `Card` + 3 çocuk elementle kurulur, görünüm de
 * ızgaradan inen seçicilerle dayatılırdı — hatta koyu tema düzeltmesi
 * `[&_.text-gray-950]:!text-on-dark` gibi UTILITY SINIFINI hedefliyordu, yani
 * çocuğun rengi değişince sessizce bozulan bir bağdı.
 *
 * ── Bağlayıcı çizgi ─────────────────────────────────────────────────────────
 * Çizgi artık ızgaranın tamamına değil, SON ADIM HARİÇ her adımın rozetinden
 * bir sonrakine çizilir (`:not(:last-child)`). Eskiden `before:left-0/right-0`
 * ile tüm satır boyunca uzuyor ve son rozetin ötesine taşıyordu.
 */

import { cn } from "@/lib/cn";
import { hideIfEmpty, renderSlot, type SlotRenderer } from "@/lib/renderSlot";
import { getL, useIsEditing } from "@/lib/utils";
import { createIconField, createLanguageField } from "@tecof/theme-editor";
import * as LucideIcons from "lucide-react";
import { useLocale } from "next-intl";

/* Dinamik class string YASAK — varyantlar class map ile çözülür. */
const COLS: Record<string, string> = {
    "2": "sm:grid-cols-2",
    "3": "sm:grid-cols-2 lg:grid-cols-3",
    "4": "sm:grid-cols-2 lg:grid-cols-4",
};

const THEME: Record<string, { section: string; badge: string; title: string; text: string; line: string; card: string }> = {
    beyaz: {
        section: "bg-surface",
        badge: "bg-primary-700 text-on-dark",
        title: "text-ink",
        text: "text-ink-soft",
        line: "border-line",
        card: "border-line bg-canvas",
    },
    krem: {
        section: "bg-canvas",
        badge: "bg-primary-700 text-on-dark",
        title: "text-ink",
        text: "text-ink-soft",
        line: "border-primary-200",
        card: "border-line bg-surface",
    },
    koyu: {
        section: "bg-primary-950 text-on-dark",
        badge: "bg-surface text-primary-900",
        title: "text-on-dark",
        text: "text-primary-200",
        line: "border-on-dark/20",
        card: "border-on-dark/10 bg-surface/[0.04]",
    },
};

type Step = {
    icon?: string;
    title?: unknown;
    description?: unknown;
};

type ProcessStepsProps = {
    className?: string;
    orientation?: string;
    columns?: string;
    showConnector?: string;
    background?: string;
    cardStyle?: string;
    contentSlot?: SlotRenderer;
    steps?: Step[];
};

export const ProcessStepsRender = (props: Record<string, unknown>) => {
    const locale = useLocale() || "tr";
    const isEditing = useIsEditing();
    const p = props as ProcessStepsProps;

    const t = THEME[p.background || "beyaz"] || THEME.beyaz;
    const vertical = p.orientation === "dikey";
    const connector = (p.showConnector ?? "evet") !== "hayir";
    const boxed = (p.cardStyle ?? "sade") === "kutulu";
    const steps = p.steps || [];
    const cols = COLS[p.columns || "3"] ? p.columns || "3" : "3";

    const has = (slot: SlotRenderer | undefined) => isEditing || !!slot;
    const hideEmpty = hideIfEmpty(isEditing);

    return (
        <section className={cn("relative isolate overflow-hidden py-16 lg:py-24", t.section, p.className)}>
            <div className="container">
                {has(p.contentSlot) ? (
                    <div className={cn("mb-12 max-w-3xl lg:mb-16", hideEmpty)}>
                        {/* className ŞARTTI: önceden renderSlot'a hiç geçilmiyordu,
                            bu yüzden üst başlık ile başlık arasında 0px boşluk
                            kalıyordu (ölçüldü). */}
                        {renderSlot(p.contentSlot, {
                            className: "flex! flex-col! items-start! gap-3! text-left",
                        })}
                    </div>
                ) : null}

                {steps.length === 0 ? (
                    <p className={cn("py-10 text-center text-sm", t.text)}>Henüz adım eklenmedi.</p>
                ) : (
                    <ol
                        className={cn(
                            "grid gap-8",
                            vertical ? "grid-cols-1 gap-6" : cn("grid-cols-1", COLS[cols])
                        )}
                    >
                        {steps.map((step, index) => {
                            const title = getL(step.title, locale) as string;
                            const description = getL(step.description, locale) as string;
                            const Icon = step.icon
                                ? (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon | undefined>)[step.icon]
                                : null;
                            const isLast = index === steps.length - 1;

                            return (
                                <li
                                    key={index}
                                    className={cn(
                                        "relative flex gap-4",
                                        vertical ? "flex-row items-start" : "flex-col",
                                        boxed && "rounded-2xl border p-6",
                                        boxed && t.card
                                    )}
                                >
                                    {/* Bağlayıcı: yatayda rozetin sağından bir sonraki
                                        adıma, dikeyde rozetin altından aşağıya. Son
                                        adımda hiç çizilmez — çizgi ızgara dışına taşmaz. */}
                                    {connector && !isLast && !boxed ? (
                                        <span
                                            aria-hidden="true"
                                            className={cn(
                                                "pointer-events-none absolute border-dashed",
                                                t.line,
                                                vertical
                                                    ? "left-5 top-12 h-[calc(100%-1rem)] border-l-2"
                                                    : "left-12 top-5 hidden w-[calc(100%-2rem)] border-t-2 sm:block"
                                            )}
                                        />
                                    ) : null}

                                    <span
                                        className={cn(
                                            "relative z-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                                            t.badge
                                        )}
                                    >
                                        {Icon ? <Icon className="size-5" strokeWidth={1.75} /> : index + 1}
                                    </span>

                                    <div className="min-w-0">
                                        {title ? (
                                            <h3 className={cn("text-base font-semibold leading-snug", t.title)} data-tecof-prop="title">
                                                {title}
                                            </h3>
                                        ) : null}
                                        {description ? (
                                            <p className={cn("mt-1.5 text-sm leading-7", t.text)} data-tecof-prop="description">
                                                {description}
                                            </p>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
        </section>
    );
};

const step = (icon: string, trTitle: string, enTitle: string, trDesc: string, enDesc: string) => ({
    icon,
    title: [
        { code: "tr", value: trTitle },
        { code: "en", value: enTitle },
    ],
    description: [
        { code: "tr", value: trDesc },
        { code: "en", value: enDesc },
    ],
});

export const ProcessSteps = {
    label: "Süreç Adımları",
    resizable: false,

    fields: {
        orientation: {
            type: "radio" as const,
            label: "Yön",
            options: [
                { label: "Yatay", value: "yatay" },
                { label: "Dikey", value: "dikey" },
            ],
        },
        columns: {
            type: "radio" as const,
            label: "Sütun (yatay)",
            options: [
                { label: "2", value: "2" },
                { label: "3", value: "3" },
                { label: "4", value: "4" },
            ],
        },
        cardStyle: {
            type: "radio" as const,
            label: "Adım Görünümü",
            options: [
                { label: "Sade (çizgili)", value: "sade" },
                { label: "Kutulu", value: "kutulu" },
            ],
        },
        showConnector: {
            type: "radio" as const,
            label: "Bağlayıcı Çizgi (sade görünümde)",
            options: [
                { label: "Göster", value: "evet" },
                { label: "Gizle", value: "hayir" },
            ],
        },
        background: {
            type: "select" as const,
            label: "Arka Plan",
            options: [
                { label: "Beyaz", value: "beyaz" },
                { label: "Krem", value: "krem" },
                { label: "Koyu", value: "koyu" },
            ],
        },
        contentSlot: {
            type: "slot" as const,
            label: "Başlık ve Açıklama",
            allow: ["Title", "Paragraph", "Spacer", "Divider"],
        },
        /* Adımlar SLOT değil ARRAY: numara/ikon ve bağlayıcı çizgi sıraya bağlı
           olduğu için sırayı bilen taraf section olmalı. */
        steps: {
            type: "array" as const,
            label: "Adımlar",
            getItemSummary: (item: Step) => (getL(item.title, "tr") as string) || "Adım",
            arrayFields: {
                icon: createIconField({ label: "İkon (boşsa sıra numarası)" }),
                title: createLanguageField({ label: "Adım Başlığı" }),
                description: createLanguageField({ label: "Açıklama", isTextarea: true }),
            },
        },
    },

    /* Inspector alan grupları — gruplanmayan alan kaybolmaz,
       grupların altında düz listelenir. */
    fieldsGroups: [
        { name: "İçerik", fields: ["steps"] },
        { name: "Alanlar", fields: ["contentSlot"] },
        { name: "Görünüm", fields: ["orientation", "columns", "cardStyle", "background"] },
        { name: "Davranış", fields: ["showConnector"] },
    ],

    variants: {
        yatay3: { label: "Yatay 3'lü", props: { orientation: "yatay", columns: "3", cardStyle: "sade" } },
        kutulu: { label: "Kutulu Kartlar", props: { orientation: "yatay", columns: "3", cardStyle: "kutulu" } },
        dikey: { label: "Dikey Zaman Çizelgesi", props: { orientation: "dikey", cardStyle: "sade" } },
    },

    defaultProps: {
        id: "ProcessSteps-1",
        orientation: "yatay",
        columns: "3",
        cardStyle: "sade",
        showConnector: "evet",
        background: "beyaz",

        contentSlot: [
            {
                type: "Title",
                props: {
                    id: "process-eyebrow",
                    text: [
                        { code: "tr", value: "Nasıl Üretiliyor?" },
                        { code: "en", value: "How It's Made" },
                    ],
                    size: "xs",
                    align: "left",
                },
            },
            {
                type: "Title",
                props: {
                    id: "process-title",
                    text: [
                        { code: "tr", value: "Tazeden Cipse: Freeze-Dry Süreci" },
                        { code: "en", value: "From Fresh to Chips: The Freeze-Dry Process" },
                    ],
                    size: "md",
                    align: "left",
                    className: "max-w-2xl",
                },
            },
        ] as unknown as SlotRenderer,

        steps: [
            step(
                "Apple",
                "Taze Meyve Seçimi",
                "Fresh Fruit Selection",
                "Mevsiminde toplanan meyveler özenle ayıklanır ve dilimlenir.",
                "Seasonal fruits are carefully sorted and sliced."
            ),
            step(
                "Snowflake",
                "Dondurarak Kurutma",
                "Freeze Drying",
                "Freeze-dry teknolojisiyle su, besin değerini koruyarak uzaklaştırılır.",
                "Freeze-drying removes water while preserving nutritional value."
            ),
            step(
                "PackageCheck",
                "Hijyenik Paketleme",
                "Hygienic Packaging",
                "Katkısız ürün, tazeliğini koruyan özel ambalajında paketlenir.",
                "The additive-free product is packed in freshness-preserving packaging."
            ),
        ],
    },

    render: ProcessStepsRender,
};

export default ProcessSteps;
