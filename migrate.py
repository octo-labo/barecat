"""
Migrate Copilot CLI events.jsonl → barecat events.jsonl
Strips all metadata, keeps only pure user/assistant conversation content.

Copilot CLI format:
  - user.message:        data.content (raw string), data.transformedContent (with CLI wrappers)
  - assistant.message:   data.content (text string), data.toolRequests (tool calls)
  - tool.execution_complete: data.toolCallId, data.result

barecat format:
  - {"type":"message","role":"user","content":"...","timestamp":"..."}
  - {"type":"message","role":"assistant","content":"...","timestamp":"..."}
  - Tool calls preserved as Anthropic API content blocks for continuity

Usage:
  python migrate.py <source_events.jsonl> [output_events.jsonl]

If output is omitted, writes to ~/.barecat/sessions/default/events.jsonl
"""
import json
import sys
import os

def migrate(src_path: str, dst_path: str):
    events_out = []
    user_count = 0
    asst_count = 0
    skipped = 0

    with open(src_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue

            t = obj.get('type', '')
            ts = obj.get('timestamp', '')

            if t == 'user.message':
                data = obj.get('data', {})
                # Use raw content, NOT transformedContent
                # transformedContent has CLI wrappers: <current_datetime>, <reminder>, <sql_tables>
                content = data.get('content', '')
                if not content:
                    skipped += 1
                    continue

                events_out.append({
                    "type": "message",
                    "role": "user",
                    "content": content,
                    "timestamp": ts,
                })
                user_count += 1

            elif t == 'assistant.message':
                data = obj.get('data', {})
                # Copilot CLI format: data.content is a direct string
                content_text = data.get('content', '')

                # Only keep messages with actual text content
                # Skip tool-only messages entirely — they add no relationship value
                # and cause tool_use/tool_result pairing issues
                if not content_text:
                    skipped += 1
                    continue

                events_out.append({
                    "type": "message",
                    "role": "assistant",
                    "content": content_text,
                    "timestamp": ts,
                })
                asst_count += 1

            else:
                skipped += 1

    # Write output
    out_dir = os.path.dirname(dst_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(dst_path, 'w', encoding='utf-8', errors='surrogatepass') as f:
        for evt in events_out:
            line = json.dumps(evt, ensure_ascii=False)
            # Fix lone surrogates (broken emoji from clipboard etc.)
            line = line.encode('utf-8', errors='surrogatepass').decode('utf-8', errors='replace')
            f.write(line + '\n')

    # Stats
    src_size = os.path.getsize(src_path)
    dst_size = os.path.getsize(dst_path)
    reduction = (1 - dst_size / src_size) * 100

    print(f"=== Migration Complete ===")
    print(f"Source:     {src_path}")
    print(f"Output:     {dst_path}")
    print()
    print(f"User msgs:     {user_count}")
    print(f"Asst msgs:     {asst_count}")
    print(f"Skipped:       {skipped} events (metadata/hooks/tools)")
    print(f"Output events: {len(events_out)}")
    print()
    print(f"Before:     {src_size/1024:.1f} KB")
    print(f"After:      {dst_size/1024:.1f} KB")
    print(f"Reduction:  {reduction:.1f}%")
    print()
    print("Next steps:")
    print("  1. Review the output file to verify conversation integrity")
    print("  2. Copy to ~/.barecat/sessions/<name>/events.jsonl")
    print("  3. Start barecat: npm run dev")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python migrate.py <source_events.jsonl> [output_path]")
        sys.exit(1)

    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.expanduser('~'), '.barecat', 'sessions', 'default', 'events.jsonl'
    )

    if not os.path.exists(src):
        print(f"Error: {src} not found")
        sys.exit(1)

    migrate(src, dst)
