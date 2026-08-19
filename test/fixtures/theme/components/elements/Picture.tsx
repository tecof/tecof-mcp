"use client";

/** Picture — slot kompozisyonu ve bölümler için ortak görsel/resim elementi. */

import { cn } from "@/lib/cn";
import { createUploadField, TecofPicture } from "@tecof/theme-editor";

export const PictureRender = (props: Record<string, unknown>) => {
    const p = props as any;
    const mediaData = Array.isArray(p.media) && p.media[0] ? p.media[0] : null;

    if (!mediaData) return null;

    return (
        <TecofPicture
            data={mediaData}
            alt={p.alt || "Görsel"}
            imgClassName={cn("w-full h-auto object-cover", p.imgClassName)}
            className={p.className}
        />
    );
};

export const Picture = {
    label: "Görsel",
    fields: {
        media: createUploadField({ label: "Görsel", allowMultiple: false }),
        alt: { type: "text" as const, label: "Alt Metin" },
    },
    defaultProps: {
        id: "Picture-1",
        media: [],
        alt: "",
    },
    render: PictureRender,
};

export default Picture;
