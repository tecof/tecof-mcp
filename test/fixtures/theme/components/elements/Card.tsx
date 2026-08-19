"use client";

import { cn } from "@/lib/cn";
import { renderSlot } from "@/lib/renderSlot";
import { getL } from "@/lib/utils";
import {
    createLinkField,
    type LinkFieldValue,
} from "@tecof/theme-editor";
import { useLocale } from "next-intl";
import Link from "next/link";

export const CardRender = (props: Record<string, unknown>) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const locale = useLocale() || "tr";
    const p = props as any;

    const link = getL(p.href, locale) as LinkFieldValue | undefined;
    const hasLink = !!link?.url && link.url !== "#";

    // Node kimlik sınıfları (p.className) her zaman EN DIŞ elemanda olmalı:
    // link'li dalda Link taşır, linksiz dalda iç div taşır (çifte basma olmasın).
    const body = (className?: string) => (
        <div className={cn("group block", className)}>
            {renderSlot(p.contentSlot)}
        </div>
    );

    return hasLink ? (
        <Link href={link!.url} target={link?.target || "_self"} className={p.className}>
            {body()}
        </Link>
    ) : (
        body(p.className)
    );
};

export const Card = {
    label: "Kart",
    fields: {
        contentSlot: {
            type: "slot" as const,
            label: "İçerik (Görsel, Başlık, Paragraf, Buton vb.)",
            allow: ["Title", "Paragraph", "Button", "Picture", "Spacer", "Divider", "Video"],
        },
        href: createLinkField({ label: "Bağlantı" }),
    },
    defaultProps: {
        id: "Card-1",
        contentSlot: [
            {
                type: "Picture",
                props: {
                    id: "card-image",
                    media: [],
                    alt: "Kart Görseli",
                },
            },
            {
                type: "Title",
                props: {
                    id: "card-title",
                    text: [
                        { code: "tr", value: "Kart Başlığı" },
                        { code: "en", value: "Card Title" },
                    ],
                    size: "xs",
                },
            },
            {
                type: "Paragraph",
                props: {
                    id: "card-desc",
                    text: [
                        { code: "tr", value: "Kısa açıklama metni." },
                        { code: "en", value: "Short description text." },
                    ],
                },
            },
        ],
        href: [{ code: "tr", value: { url: "#", target: "_self" } }],
    },
    render: CardRender,
};

export default Card;
