fn contains_latex_delimiter(text: &str) -> bool {
    text.contains("$$") || text.contains('$')
}

fn split_markdown_list_prefix(line: &str) -> (&str, &str) {
    let indent_len = line
        .find(|ch: char| ch != ' ' && ch != '\t')
        .unwrap_or(line.len());
    let rest = &line[indent_len..];

    if rest.starts_with("- ") || rest.starts_with("* ") || rest.starts_with("+ ") {
        let prefix_len = indent_len + 2;
        return (&line[..prefix_len], &line[prefix_len..]);
    }

    let bytes = rest.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx > 0
        && idx + 1 < bytes.len()
        && (bytes[idx] == b'.' || bytes[idx] == b')')
        && bytes[idx + 1] == b' '
    {
        let prefix_len = indent_len + idx + 2;
        return (&line[..prefix_len], &line[prefix_len..]);
    }

    ("", line)
}

fn extract_wikipedia_displaystyle_block(line: &str, start: usize) -> Option<(usize, String)> {
    const DISPLAYSTYLE_PREFIX: &str = "{\\displaystyle";
    if !line[start..].starts_with(DISPLAYSTYLE_PREFIX) {
        return None;
    }

    let bytes = line.as_bytes();
    let mut depth = 0i32;
    let mut idx = start;
    while idx < bytes.len() {
        match bytes[idx] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        idx += 1;
    }

    if depth != 0 {
        return None;
    }
    let end_exclusive = idx + 1;
    let inner = line[start + DISPLAYSTYLE_PREFIX.len()..idx].trim().to_string();
    Some((end_exclusive, inner))
}

fn normalize_wikipedia_displaystyle_line(line: &str) -> (String, bool) {
    let mut cursor = 0usize;
    let mut output = String::new();
    let mut changed = false;

    while let Some(rel_idx) = line[cursor..].find("{\\displaystyle") {
        let start = cursor + rel_idx;
        output.push_str(&line[cursor..start]);

        if let Some((end_exclusive, inner)) = extract_wikipedia_displaystyle_block(line, start) {
            if inner.is_empty() {
                output.push_str(&line[start..end_exclusive]);
                cursor = end_exclusive;
                continue;
            }
            output.push('$');
            output.push_str(inner.trim());
            output.push('$');
            changed = true;
            cursor = end_exclusive;
        } else {
            output.push_str(&line[start..]);
            cursor = line.len();
            break;
        }
    }

    if cursor < line.len() {
        output.push_str(&line[cursor..]);
    }

    if changed {
        (output, true)
    } else {
        (line.to_string(), false)
    }
}

pub(crate) fn normalize_wikipedia_displaystyle_notation(output: &str) -> String {
    let mut in_code_fence = false;
    let mut changed = false;
    let mut lines = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_code_fence = !in_code_fence;
            lines.push(line.to_string());
            continue;
        }
        if in_code_fence {
            lines.push(line.to_string());
            continue;
        }
        let (normalized_line, line_changed) = normalize_wikipedia_displaystyle_line(line);
        changed |= line_changed;
        lines.push(normalized_line);
    }

    if !changed {
        return output.to_string();
    }

    let mut normalized = lines.join("\n");
    if output.ends_with('\n') {
        normalized.push('\n');
    }
    normalized
}

fn looks_math_equation_line(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.len() < 3 || trimmed.len() > 180 {
        return false;
    }
    if contains_latex_delimiter(trimmed)
        || trimmed.contains('`')
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
    {
        return false;
    }

    let has_operator = trimmed.chars().any(|ch| {
        matches!(
            ch,
            '='
                | '+'
                | '-'
                | '*'
                | '/'
                | '^'
                | '×'
                | '÷'
                | '±'
                | '∑'
                | '∫'
                | '√'
                | '≤'
                | '≥'
                | '≠'
                | '≈'
                | '∞'
                | '∂'
                | '∇'
                | '→'
                | '←'
                | '↔'
        )
    });
    if !has_operator {
        return false;
    }

    let has_operand = trimmed.chars().any(|ch| ch.is_ascii_digit())
        || trimmed.chars().any(|ch| ch.is_ascii_alphabetic())
        || trimmed.chars().any(|ch| {
            matches!(
                ch,
                'π' | 'θ' | 'λ' | 'μ' | 'α' | 'β' | 'γ' | 'δ' | 'σ' | 'ω'
            )
        });
    if !has_operand {
        return false;
    }

    let mut non_math_long_words = 0usize;
    for token in trimmed.split_whitespace() {
        let cleaned = token.trim_matches(|ch: char| !ch.is_ascii_alphabetic());
        if cleaned.len() < 4 {
            continue;
        }
        let lower = cleaned.to_ascii_lowercase();
        let is_math_word = matches!(
            lower.as_str(),
            "sin"
                | "cos"
                | "tan"
                | "cot"
                | "sec"
                | "csc"
                | "log"
                | "ln"
                | "lim"
                | "frac"
                | "sqrt"
                | "sum"
                | "prod"
                | "int"
                | "text"
                | "math"
                | "alpha"
                | "beta"
                | "gamma"
                | "delta"
                | "theta"
                | "sigma"
                | "omega"
        );
        if !is_math_word {
            non_math_long_words += 1;
            if non_math_long_words > 1 {
                return false;
            }
        }
    }

    true
}

pub(crate) fn enforce_math_latex_delimiters(output: &str) -> String {
    let mut in_code_fence = false;
    let mut changed = false;
    let mut lines = Vec::new();

    for line in output.lines() {
        let trimmed_start = line.trim_start();
        if trimmed_start.starts_with("```") {
            in_code_fence = !in_code_fence;
            lines.push(line.to_string());
            continue;
        }
        if in_code_fence {
            lines.push(line.to_string());
            continue;
        }
        if contains_latex_delimiter(line) {
            lines.push(line.to_string());
            continue;
        }

        let (prefix, content) = split_markdown_list_prefix(line);
        let trimmed_content = content.trim();
        if looks_math_equation_line(trimmed_content) {
            changed = true;
            lines.push(format!("{prefix}${trimmed_content}$"));
            continue;
        }

        let mut inline_converted = false;
        for sep in [':', '：'] {
            if let Some(idx) = trimmed_content.find(sep) {
                let head = trimmed_content[..idx].trim();
                let expr = trimmed_content[idx + sep.len_utf8()..].trim();
                if !head.is_empty()
                    && head.chars().count() <= 14
                    && looks_math_equation_line(expr)
                    && !contains_latex_delimiter(expr)
                {
                    changed = true;
                    lines.push(format!("{prefix}{head}{sep} ${expr}$"));
                    inline_converted = true;
                    break;
                }
            }
        }
        if inline_converted {
            continue;
        }

        lines.push(line.to_string());
    }

    if !changed {
        return output.to_string();
    }

    let mut normalized = lines.join("\n");
    if output.ends_with('\n') {
        normalized.push('\n');
    }
    normalized
}

pub(crate) fn normalize_math_output(output: &str) -> String {
    let wikipedia_normalized = normalize_wikipedia_displaystyle_notation(output);
    enforce_math_latex_delimiters(&wikipedia_normalized)
}
