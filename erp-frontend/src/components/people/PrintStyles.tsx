/**
 * Clean print stylesheet for printable HR documents: hides the app chrome
 * (sidebar, header, toaster, buttons) and prints the content full width.
 */
export default function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: A4; margin: 12mm; }
        aside, header, .no-print, [data-sonner-toaster] { display: none !important; }
        html, body { background: #fff !important; }
        main { padding: 0 !important; background: #fff !important; }
        .print-sheet { border: none !important; box-shadow: none !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
        .print-sheet table { page-break-inside: avoid; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `}</style>
  );
}
