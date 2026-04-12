import { jsx as _jsx } from "react/jsx-runtime";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
const ibmPlexSans = IBM_Plex_Sans({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-sans",
    weight: ["400", "500", "600", "700"],
});
export const metadata = {
    title: "SliceX",
    description: "Timeline editor workspace for SliceX.",
};
export default function RootLayout({ children, }) {
    return (_jsx("html", { lang: "en", className: ibmPlexSans.variable, children: _jsx("body", { children: children }) }));
}
