#!/usr/bin/env python3
import json
import re
import os
from datetime import datetime

def export_conversation():
    transcript_path = '/Users/nurimilanmodabber/.gemini/antigravity/brain/82155c25-cdb7-4c69-b473-584c6900c1c9/.system_generated/logs/transcript_full.jsonl'
    output_md_path = '/Users/nurimilanmodabber/Documents/antigravity/vibrant-brahmagupta/CHAT_CONVERSATION_HISTORY.md'

    with open(transcript_path, 'r', encoding='utf-8') as f:
        events = [json.loads(line) for line in f]

    turns = []
    current_turn = None

    for ev in events:
        etype = ev.get('type')
        src = ev.get('source')
        
        if etype == 'USER_INPUT' and src == 'USER_EXPLICIT':
            if current_turn is not None:
                turns.append(current_turn)
            
            content = ev.get('content', '')
            m = re.search(r'<USER_REQUEST>(.*?)</USER_REQUEST>', content, re.DOTALL)
            user_text = m.group(1).strip() if m else content.strip()
            created_at = ev.get('created_at', '')
            media = ev.get('media', [])
            
            current_turn = {
                'turn_num': len(turns) + 1,
                'timestamp': created_at,
                'user_text': user_text,
                'media': media,
                'assistant_messages': [],
                'tools_called': [],
                'errors': []
            }
        elif current_turn is not None:
            if etype == 'PLANNER_RESPONSE':
                content = ev.get('content', '')
                tool_calls = ev.get('tool_calls', [])
                created_at = ev.get('created_at', '')
                
                if content and content.strip():
                    if not current_turn['assistant_messages'] or current_turn['assistant_messages'][-1]['text'] != content.strip():
                        current_turn['assistant_messages'].append({
                            'text': content.strip(),
                            'timestamp': created_at
                        })
                for tc in tool_calls:
                    name = tc.get('name')
                    summary = tc.get('toolSummary') or tc.get('toolAction') or ''
                    current_turn['tools_called'].append({'name': name, 'summary': summary})
            elif etype == 'ERROR_MESSAGE':
                current_turn['errors'].append(ev.get('content', 'Error'))

    if current_turn is not None:
        turns.append(current_turn)

    lines = []
    lines.append('# Rhein-Neckar Aktionskarte — Vollständiger Chat-Verlauf (Full Conversation History)')
    lines.append('')
    lines.append('> **Projekt:** Rhein-Neckar Aktionskarte (`rhein-neckar-aktionskarte`)  ')
    lines.append('> **Conversation ID:** `82155c25-cdb7-4c69-b473-584c6900c1c9`  ')
    lines.append('> **Zeitraum:** 26. September 2026 – 30. September 2026  ')
    lines.append(f'> **Gesamtanzahl Dialogschritte (Turns):** {len(turns)}  ')
    lines.append(f'> **Generiert am:** {datetime.now().strftime("%d.%m.%Y %H:%M:%S")}  ')
    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## Inhaltsverzeichnis / Table of Contents')
    lines.append('')

    for t in turns:
        num = t['turn_num']
        first_line = t['user_text'].split('\n')[0].strip()
        clean_title = re.sub(r'[*_#`]', '', first_line)[:75]
        if len(first_line) > 75:
            clean_title += '...'
        ts = t['timestamp'][:19].replace('T', ' ')
        anchor = f"turn-{num}"
        lines.append(f"- [Turn {num:02d}: {clean_title} ({ts})](#{anchor})")

    lines.append('')
    lines.append('---')
    lines.append('')

    for t in turns:
        num = t['turn_num']
        ts = t['timestamp'][:19].replace('T', ' ')
        anchor = f"turn-{num}"
        
        first_line = t['user_text'].split('\n')[0].strip()
        clean_title = re.sub(r'[*_#`]', '', first_line)[:90]
        
        lines.append(f'<a id="{anchor}"></a>')
        lines.append(f'## Turn {num}: {clean_title}')
        lines.append(f'*Zeitstempel: {ts} UTC*')
        lines.append('')
        lines.append('### 👤 User')
        lines.append('')
        lines.append(t['user_text'])
        lines.append('')
        
        if t['media']:
            lines.append('**Angehängte Medien / Dateien:**')
            for m in t['media']:
                uri = m.get('uri', '')
                mime = m.get('mime_type', '')
                filename = os.path.basename(uri)
                lines.append(f'- `{filename}` ({mime})')
            lines.append('')
        
        lines.append('### 🤖 Antigravity Assistant')
        lines.append('')
        
        if t['assistant_messages']:
            for i, amsg in enumerate(t['assistant_messages']):
                if len(t['assistant_messages']) > 1:
                    lines.append(f'*Antwort Teil {i+1}:*')
                    lines.append('')
                lines.append(amsg['text'])
                lines.append('')
        else:
            if num == len(turns):
                lines.append('*(Aktuelle Anfrage wird gerade beantwortet)*')
            else:
                lines.append('*(Anfrage wurde im Rahmen der direkt folgenden Arbeitsschritte/Nachrichten weiterbearbeitet)*')
            lines.append('')
        
        if t['tools_called']:
            tool_counts = {}
            for tc in t['tools_called']:
                name = tc['name'] or 'unknown'
                tool_counts[name] = tool_counts.get(name, 0) + 1
            summary_str = ', '.join([f'{cnt}× {name}' for name, cnt in sorted(tool_counts.items(), key=lambda x: -x[1])])
            lines.append('<details>')
            lines.append(f'<summary>⚙️ <em>Ausgeführte Werkzeuge ({len(t["tools_called"])} Aktionen: {summary_str})</em></summary>')
            lines.append('')
            lines.append('| Werkzeug | Aktion / Zusammenfassung |')
            lines.append('|---|---|')
            for tc in t['tools_called']:
                lines.append(f"| `{tc['name']}` | {tc['summary'] or '-'} |")
            lines.append('')
            lines.append('</details>')
            lines.append('')
        
        lines.append('---')
        lines.append('')

    output_content = '\n'.join(lines)
    with open(output_md_path, 'w', encoding='utf-8') as f:
        f.write(output_content)

    print(f'Successfully wrote {len(output_content)} bytes ({len(lines)} lines) to {output_md_path}')

if __name__ == '__main__':
    export_conversation()
