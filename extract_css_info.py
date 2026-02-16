import glob
import re
import os

files = glob.glob('frontend/web/public/js/modules/pages/*.js')
files.extend(['frontend/web/public/app.js', 'frontend/web/public/index.html'])
files.extend(glob.glob('frontend/web/public/js/components/*.js'))

# Sort for consistent output
files.sort()

print("File Analysis Report")
print("====================")

for file_path in files:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Check for <style> tags
        style_matches = re.findall(r'<style[^>]*>(.*?)</style>', content, re.DOTALL)
        
        # Check for inline style attributes
        inline_style_matches = re.findall(r'style=["\']([^"\']*)["\']', content)
        
        has_styles = "NO"
        details = []
        
        if style_matches:
            has_styles = "YES"
            total_lines = 0
            selectors = set()
            
            for css in style_matches:
                lines = css.strip().split('\n')
                total_lines += len(lines)
                # Extract class and id selectors
                found_selectors = re.findall(r'([.#][a-zA-Z0-9_-]+)[^{]*\{', css)
                for s in found_selectors:
                    selectors.add(s.strip())
            
            details.append(f"Contains <style> block ({total_lines} lines)")
            if selectors:
                # Limit to first 5 for brevity
                selector_list = list(selectors)[:5]
                details.append(f"Selectors: {', '.join(selector_list)} ... ({len(selectors)} total)")
        
        if inline_style_matches:
            if has_styles == "NO":
                has_styles = "YES (Attributes only)"
            details.append(f"Inline style attributes found: {len(inline_style_matches)} instances")
            
        print(f"File: {file_path}")
        print(f"Inline Styles: {has_styles}")
        if details:
            for d in details:
                print(f"  - {d}")
        print("-" * 20)
            
    except Exception as e:
        print(f"Error reading {file_path}: {e}")

