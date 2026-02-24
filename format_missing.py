import os
import re
from collections import defaultdict

directory = '/Volumes/MAC_APP/openmake_llm/frontend/web/public'
tag_pattern = re.compile(r'<(input|select|textarea)\b([^>]*)>', re.IGNORECASE | re.DOTALL)

results = defaultdict(list)

for root, dirs, files in os.walk(directory):
    for file in files:
        if file.endswith('.html') or file.endswith('.js'):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    
                for match in tag_pattern.finditer(content):
                    tag_name = match.group(1)
                    attributes = match.group(2)
                    
                    has_id = bool(re.search(r'\bid\s*=', attributes, re.IGNORECASE))
                    has_name = bool(re.search(r'\bname\s*=', attributes, re.IGNORECASE))
                    
                    if not has_id or not has_name:
                        line_no = content.count('\n', 0, match.start()) + 1
                        clean_tag = f"<{tag_name}{attributes}>".replace('\n', ' ').replace('\r', '')
                        clean_tag = re.sub(r'\s+', ' ', clean_tag)
                        missing = []
                        if not has_id: missing.append('id')
                        if not has_name: missing.append('name')
                        results[filepath].append(f"Line {line_no}: [Missing {' and '.join(missing)}] {clean_tag}")
            except Exception as e:
                pass

for filepath, lines in sorted(results.items()):
    print(f"\nFile: {filepath}")
    for line in lines:
        print(f"  - {line}")
