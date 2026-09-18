import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mde.css";

export const metadata: Metadata = {
  title: "KassenSpiel – Supermarkt-Kassensimulator",
  description: "Spiele an einer modernen Supermarkt-Kasse: Produkte scannen, kassieren und Bons erstellen.",
  openGraph: { title:"KassenSpiel – Supermarkt-Kassensimulator", description:"Produkte scannen, kassieren und den eigenen Tagesumsatz steigern.", type:"website", images:["https://kassenspiel.yildizwerbetechnik.chatgpt.site/og.png"] },
  twitter: { card:"summary_large_image", title:"KassenSpiel", description:"Der spielbare Supermarkt-Kassensimulator.", images:["https://kassenspiel.yildizwerbetechnik.chatgpt.site/og.png"] },
  icons: { icon:"/favicon.svg", shortcut:"/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="de"><body>{children}</body></html>}
