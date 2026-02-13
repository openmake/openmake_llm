import os
import re
import glob
import json

PUBLIC_DIR = "frontend/web/public"

def get_files(extension):
    return glob.glob(f"{PUBLIC_DIR}/**/*.{extension}", recursive=True)

def audit_css_vars():
    defined_vars = set()
    used_vars = set()
    
    css_files = get_files("css")
    for file_path in css_files:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # Find definitions: --variable-name: value;
            defined = re.findall(r'(--[a-zA-Z0-9-]+)\s*:', content)
            defined_vars.update(defined)
            
            # Find usages: var(--variable-name)
            used = re.findall(r'var\((--[a-zA-Z0-9-]+)\)', content)
            used_vars.update(used)
            
    missing = used_vars - defined_vars
    # Filter out potential false positives or dynamic vars if any (though usually CSS vars are static)
    # Some vars might be defined in inline styles or JS, but that's rare for a token system.
    return list(missing)

def audit_html_issues():
    issues = []
    html_files = get_files("html")
    
    ids_seen = {} # id -> [files]
    
    for file_path in html_files:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
            # Check img alt
            imgs = re.finditer(r'<img\s+([^>]*)>', content)
            for img in imgs:
                attrs = img.group(1)
                if 'alt=' not in attrs:
                    issues.append(f"{file_path}: <img> missing alt attribute")
                elif re.search(r'alt=["\']\s*["\']', attrs):
                    issues.append(f"{file_path}: <img> has empty alt attribute")
                    
            # Check links
            links = re.finditer(r'<a\s+([^>]*)>', content)
            for link in links:
                attrs = link.group(1)
                href_match = re.search(r'href=["\']([^"\']*)["\']', attrs)
                if href_match:
                    href = href_match.group(1)
                    if href == "" or href == "#":
                         # Sometimes # is used for JS triggers, but often it's a placeholder
                         pass 
                    elif not href.startswith(('http', 'mailto:', 'tel:', 'javascript:')):
                        # Check local file existence
                        # Handle anchors
                        path_part = href.split('#')[0]
                        if path_part:
                            # Relative path resolution
                            curr_dir = os.path.dirname(file_path)
                            abs_target = os.path.abspath(os.path.join(curr_dir, path_part))
                            if not os.path.exists(abs_target):
                                issues.append(f"{file_path}: Broken link to '{href}'")

            # Check duplicate IDs
            ids = re.findall(r'id=["\']([^"\']+)["\']', content)
            file_ids = set()
            for i in ids:
                if i in file_ids:
                     issues.append(f"{file_path}: Duplicate ID '{i}' in same file")
                file_ids.add(i)
                
    return issues

def audit_manifest():
    issues = []
    manifest_path = os.path.join(PUBLIC_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        return ["manifest.json missing"]
        
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            required_keys = ["name", "short_name", "start_url", "display", "icons"]
            for key in required_keys:
                if key not in data:
                    issues.append(f"manifest.json: Missing required field '{key}'")
            
            if "icons" in data:
                for icon in data["icons"]:
                    src = icon.get("src")
                    if src:
                        icon_path = os.path.join(PUBLIC_DIR, src.lstrip('/'))
                        if not os.path.exists(icon_path):
                            issues.append(f"manifest.json: Icon not found '{src}'")
    except Exception as e:
        issues.append(f"manifest.json: Error parsing ({str(e)})")
        
    return issues

def check_orphaned_css():
    # This is a heuristic. 
    # 1. Get all class selectors from CSS.
    # 2. Check if they exist in HTML or JS.
    
    css_classes = set()
    css_files = get_files("css")
    for file_path in css_files:
         with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # Simple regex for .classname
            matches = re.findall(r'\.([a-zA-Z0-9-_]+)', content)
            css_classes.update(matches)
            
    # Remove common bootstrap/utility like classes that might be constructed dynamically if too many
    # But for now let's check exact matches
    
    used_classes = set()
    
    # Scan HTML
    html_files = get_files("html")
    for file_path in html_files:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # class="foo bar"
            matches = re.findall(r'class=["\']([^"\']+)["\']', content)
            for m in matches:
                classes = m.split()
                used_classes.update(classes)
                
    # Scan JS for classList.add('foo') or className = 'foo' or querySelector('.foo')
    js_files = get_files("js")
    for file_path in js_files:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # This is very loose, just looking for the string in JS
            for cls in css_classes:
                if cls in content:
                    used_classes.add(cls)

    orphaned = css_classes - used_classes
    # Filter out state classes commonly added by JS but maybe not explicitly named as string literals if constructed
    # e.g. 'is-' + status. 
    # We'll just report them, they might be false positives but worth checking.
    return sorted(list(orphaned))

def main():
    print("--- CSS Variable Audit ---")
    missing_vars = audit_css_vars()
    if missing_vars:
        for v in missing_vars:
            print(f"Undefined CSS Variable: {v}")
    else:
        print("No undefined CSS variables found.")
        
    print("\n--- HTML/Link Audit ---")
    html_issues = audit_html_issues()
    if html_issues:
        for i in html_issues:
            print(i)
    else:
        print("No HTML issues found.")

    print("\n--- Manifest Audit ---")
    manifest_issues = audit_manifest()
    if manifest_issues:
        for i in manifest_issues:
            print(i)
    else:
        print("Manifest looks good.")
        
    # Orphaned CSS is noisy, let's limit output or skip if too many
    # print("\n--- Potentially Orphaned CSS Classes (Top 20) ---")
    # orphaned = check_orphaned_css()
    # for c in orphaned[:20]:
    #     print(c)

if __name__ == "__main__":
    main()
