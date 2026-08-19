"use client";

/** Button — slot kompozisyonu için bağlantı/buton elementi (3 varyant). */

import { cn } from "@/lib/cn";
import { getL, useIsEditing } from "@/lib/utils";
import { createLanguageField, createLinkField, createIconField, type LinkFieldValue } from "@tecof/theme-editor";
import * as LucideIcons from "lucide-react";
import { ArrowRight } from "lucide-react";
import { useLocale } from "next-intl";
import Link from "next/link";

const VARIANTS: Record<string, string> = {
    underline:
        "text-[12px] font-medium tracking-[0.15em] uppercase text-gray-950 border-b border-gray-950 pb-1 hover:opacity-60 transition-opacity",
    solid:
        "px-7 py-3.5 text-[12px] font-medium tracking-[0.15em] uppercase text-white bg-gray-950 hover:bg-gray-800 transition-colors",
    outline:
        "px-7 py-3.5 text-[12px] font-medium tracking-[0.15em] uppercase text-gray-950 border border-gray-950 hover:bg-gray-950 hover:text-white transition-colors",
};

const ALIGNS: Record<string, string> = {
    left: "mr-auto",
    center: "mx-auto",
    right: "ml-auto",
};

export const ButtonRender = (props: Record<string, unknown>) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const locale = useLocale() || "tr";
    const isEditing = useIsEditing();
    const p = props as any;
    const link = getL(p.href, locale) as LinkFieldValue | undefined;

    const IconComponent = p.icon
        ? (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon | undefined>)[p.icon]
        : null;

    return (
        <Link
            href={link?.url || "#"}
            target={link?.target || "_self"}
            onClick={(e) => {
                if (isEditing) {
                    e.preventDefault();
                }
            }}
            className={cn(
                "flex w-fit items-center gap-2",
                VARIANTS[p.variant] || VARIANTS.underline,
                ALIGNS[p.align] || ALIGNS.left,
                p.className
            )}
        >
            <span data-tecof-prop="label">{getL(p.label, locale)}</span>
            {IconComponent ? (
                <IconComponent className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            ) : (
                p.showArrow !== "no" && (
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                )
            )}
        </Link>
    );
};

export const Button = {
    label: "Buton",
    fields: {
        label: createLanguageField({ label: "Metin" }),
        href: createLinkField({ label: "Bağlantı" }),
        variant: {
            type: "radio" as const,
            label: "Stil",
            options: [
                { label: "Alt Çizgili", value: "underline" },
                { label: "Dolu", value: "solid" },
                { label: "Çerçeveli", value: "outline" },
            ],
        },
        icon: createIconField({ label: "İkon" }),
        showArrow: {
            type: "radio" as const,
            label: "Ok İkonu",
            options: [
                { label: "Göster", value: "yes" },
                { label: "Gizle", value: "no" },
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
        id: "Button-1",
        label: [
            { code: "tr", value: "Keşfet" },
            { code: "en", value: "Discover" },
        ],
        href: [{ code: "tr", value: { url: "#", target: "_self" } }],
        variant: "underline",
        showArrow: "yes",
        icon: "",
        align: "left",
    },
    render: ButtonRender,
};

export default Button;
