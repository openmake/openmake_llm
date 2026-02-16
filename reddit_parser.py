import json
import sys

def analyze_file(filepath, source_name):
    print(f"\n--- Processing {source_name} ---")
    try:
        with open(filepath, 'r') as f:
            content = f.read()
            # Handle potential multiple JSON objects or formatting issues if truncated
            try:
                data = json.loads(content)
            except json.JSONDecodeError:
                # If file is truncated, try to cut off the last partial object
                print("Warning: File may be truncated, attempting to recover valid JSON...")
                last_brace = content.rfind('}')
                if last_brace != -1:
                    content = content[:last_brace+1]
                    try:
                        data = json.loads(content)
                    except:
                        # If still failing, try wrapping in array or just fail gracefully
                        print("Failed to recover JSON.")
                        return

        if 'data' not in data or 'children' not in data['data']:
             print("Invalid JSON structure: missing data.children")
             return

        posts = []
        for child in data['data']['children']:
            post = child['data']
            posts.append({
                'title': post.get('title', 'No Title'),
                'subreddit': post.get('subreddit', 'Unknown'),
                'num_comments': post.get('num_comments', 0),
                'score': post.get('score', 0),
                'selftext': post.get('selftext', '')[:500],
                'url': post.get('url', ''),
                'author': post.get('author', 'Unknown')
            })
        
        # Sort by comments descending
        posts.sort(key=lambda x: x['num_comments'], reverse=True)
        
        print(f"--- Top 5 Posts from {source_name} (by comments) ---")
        for i, post in enumerate(posts[:5]):
            print(f"Rank: {i+1}")
            print(f"Title: {post['title']}")
            print(f"Subreddit: r/{post['subreddit']}")
            print(f"Comments: {post['num_comments']}")
            print(f"Score: {post['score']}")
            print(f"Excerpt: {post['selftext']}")
            print("-" * 20)
            
    except Exception as e:
        print(f"Error processing {source_name}: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python reddit_parser.py <r_all_path> <r_ollama_path>")
        sys.exit(1)
        
    analyze_file(sys.argv[1], "r/all")
    analyze_file(sys.argv[2], "r/ollama")
