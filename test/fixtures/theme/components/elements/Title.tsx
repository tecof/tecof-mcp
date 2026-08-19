"use client";

/** Title — slot kompozisyonu için genel başlık elementi (editoryal serif). */

import { cn } from "@/lib/cn";
import { getL } from "@/lib/utils";
import { createLanguageField } from "@tecof/theme-editor";
import { useLocale } from "next-intl";

const SIZES: Record<string, string> = {
    xs: "text-[11px] font-medium tracking-[0.25em] uppercase text-gray-500 font-sans",
    sm: "text-xl lg:text-2xl",
    md: "text-3xl lg:text-4xl",
    lg: "text-4xl lg:text-5xl xl:text-6xl",
};

const ALIGNS: Record<string, string> = {
    left: "text-left mr-auto",
    center: "text-center mx-auto",
    right: "text-right ml-auto",
};

export const TitleRender = (props: Record<string, unknown>) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const locale = useLocale() || "tr";
    const p = props as any;
    const Tag = p.as || "h2";

    return (
        <Tag
            data-tecof-prop="text"
            className={cn(
                "font-normal tracking-tight text-gray-950 leading-[1.12] w-fit",
                SIZES[p.size] || SIZES.md,
                ALIGNS[p.align] || ALIGNS.left,
                p.className
            )}
            style={p.size === "xs" ? {} : { fontFamily: "var(--font-serif), Georgia, serif" }}
        >
            {getL(p.text, locale)}
        </Tag>
    );
};

export const Title = {
    label: "Başlık",
    fields: {
        text: createLanguageField({ label: "Metin" }),
        size: {
            type: "radio" as const,
            label: "Boyut",
            options: [
                { label: "Üst Başlık (Küçük)", value: "xs" },
                { label: "Küçük", value: "sm" },
                { label: "Orta", value: "md" },
                { label: "Büyük", value: "lg" },
            ],
        },
        align: {
            type: "radio" as const,
            label: "Hizalama",
            options: [
                { label: "Sol", value: "left" },
                { label: "Orta", value: "center" },
                { label: "Sağ", value: "right" },
            ],
        },
    },
    defaultProps: {
        id: "Title-1",
        text: [
            { code: "tr", value: "Başlık" },
            { code: "en", value: "Title" },
        ],
        size: "md",
        align: "left",
    },
    render: TitleRender,
};

export default Title;
