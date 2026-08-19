"use client";

/** Paragraph — slot kompozisyonu için zengin metin elementi. */

import { cn } from "@/lib/cn";
import { getL } from "@/lib/utils";
import { createEditorField } from "@tecof/theme-editor";
import { useLocale } from "next-intl";

const ALIGNS: Record<string, string> = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
};

export const ParagraphRender = (props: Record<string, unknown>) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const locale = useLocale() || "tr";
    const p = props as any;
    const html = getL(p.text, locale);

    return (
        <div
            data-tecof-prop="text"
            className={cn(
                "text-[15px] leading-relaxed",
                p.tone === "muted" ? "text-gray-500" : "text-gray-700",
                ALIGNS[p.align] || ALIGNS.left,
                p.className
            )}
            dangerouslySetInnerHTML={{ __html: html || "" }}
        />
    );
};

export const Paragraph = {
    label: "Paragraf",
    fields: {
        text: createEditorField({ label: "Metin" }),
        tone: {
            type: "radio" as const,
            label: "Ton",
            options: [
                { label: "Normal", value: "normal" },
                { label: "Soluk", value: "muted" },
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
        id: "Paragraph-1",
        text: [
            { code: "tr", value: "<p>Paragraf metni.</p>" },
            { code: "en", value: "<p>Paragraph text.</p>" },
        ],
        tone: "muted",
        align: "left",
    },
    render: ParagraphRender,
};

export default Paragraph;
