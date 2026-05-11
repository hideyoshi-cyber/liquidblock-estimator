import fitz  # PyMuPDF
import sys

pdf_path = r"R:\02_Library\PDF_Books\メディア別_制作料金早見表.pdf"
output_path = r"g:\マイドライブ\liquidblock-estimator\_pdf_extract.txt"

doc = fitz.open(pdf_path)
total_pages = len(doc)
print(f"Total pages: {total_pages}")

# Extract pages 220-279 (0-indexed: 219-278)
start_page = 219
end_page = min(278, total_pages - 1)

with open(output_path, 'w', encoding='utf-8') as f:
    for i in range(start_page, end_page + 1):
        page = doc[i]
        text = page.get_text()
        f.write(f"\n{'='*60}\n")
        f.write(f"PAGE {i+1}\n")
        f.write(f"{'='*60}\n")
        f.write(text)
        f.write("\n")

doc.close()
print(f"Extracted pages {start_page+1}-{end_page+1} to {output_path}")
