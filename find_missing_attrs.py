import os
import re

directory = '/Volumes/MAC_APP/openmake_llm/frontend/web/public'
# Regex to find <input ...>, <select ...>, <textarea ...>
tag_pattern = re.compile(r'<(input|select|textarea)\b([^>]*)>', re.IGNORECASE | re.DOTALL)

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
                    
                    # Check if id or name exists in attributes
                    if not re.search(r'\b(id|name)\s*=', attributes, re.IGNORECASE):
                        line_no = content.count('\n', 0, match.start()) + 1
                        # Clean up newlines in the matched tag for single-line output
                        clean_tag = f"<{tag_name}{attributes}>".replace('\n', ' ').replace('\r', '')
                        # Collapse multiple spaces
                        clean_tag = re.sub(r'\s+', ' ', clean_tag)
                        print(f"{filepath}:{line_no}: {clean_tag}")
            except Exception as e:
                print(f"Error reading {filepath}: {e}")
