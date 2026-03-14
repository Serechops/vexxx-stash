package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

var (
	// Section header bar
	styleHeader = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).  // bright white
			Background(lipgloss.Color("237")). // dark grey
			PaddingLeft(1).PaddingRight(1)

	// Status symbols
	styleOK    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("10")) // bright green
	styleWarn  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("11")) // bright yellow
	styleError = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("9"))  // bright red

	// Name column
	styleName = lipgloss.NewStyle().Width(26).Foreground(lipgloss.Color("252"))

	// Detail text (dimmed)
	styleDetail = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))

	// Overall title
	styleTitle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14")) // bright cyan

	// Summary bar
	styleSummaryOK    = lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	styleSummaryWarn  = lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	styleSummaryError = lipgloss.NewStyle().Foreground(lipgloss.Color("9"))

	// Section box border
	styleBox = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("238")).
			PaddingLeft(1).PaddingRight(1).
			MarginBottom(0)

	// Spinner frames
	spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
)

// headerLines / footerLines are the number of fixed terminal lines
// consumed by the title bar and summary footer respectively.
// vpHeight = windowHeight - headerLines - footerLines
const (
	headerLines = 3 // blank + title + blank
	footerLines = 3 // blank + summary + hint
)

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// checksReadyMsg is sent when all checks have completed.
type checksReadyMsg struct {
	report DiagReport
}

// spinTickMsg drives the spinner animation.
type spinTickMsg time.Time

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type tuiModel struct {
	width, height  int
	vp             viewport.Model
	ready          bool   // true once viewport is initialised (first WindowSizeMsg)
	pendingContent string // content buffered before first WindowSizeMsg
	report         *DiagReport
	spinnerFrame   int
	done           bool
	// args needed to run checks
	configArg string
	urlArg    string
	apiKeyArg string
}

func initialModel(configArg, urlArg, apiKeyArg string) tuiModel {
	return tuiModel{
		configArg: configArg,
		urlArg:    urlArg,
		apiKeyArg: apiKeyArg,
	}
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

func (m tuiModel) Init() tea.Cmd {
	return tea.Batch(
		runChecksCmd(m.configArg, m.urlArg, m.apiKeyArg),
		spinTickCmd(),
	)
}

func spinTickCmd() tea.Cmd {
	return tea.Tick(80*time.Millisecond, func(t time.Time) tea.Msg {
		return spinTickMsg(t)
	})
}

func runChecksCmd(configArg, urlArg, apiKeyArg string) tea.Cmd {
	return func() tea.Msg {
		results := runAllChecks(configArg, urlArg, apiKeyArg)
		return checksReadyMsg{report: buildReport(results)}
	}
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func (m tuiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "q" || msg.String() == "ctrl+c" {
			return m, tea.Quit
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		vpHeight := m.height - headerLines - footerLines
		if vpHeight < 1 {
			vpHeight = 1
		}
		if !m.ready {
			m.vp = viewport.New(m.width, vpHeight)
			m.ready = true
			if m.pendingContent != "" {
				m.vp.SetContent(m.pendingContent)
				m.pendingContent = ""
			}
		} else {
			m.vp.Width = m.width
			m.vp.Height = vpHeight
			// Re-render at new width when report is available
			if m.done && m.report != nil {
				m.vp.SetContent(m.renderContent())
			}
		}

	case checksReadyMsg:
		r := msg.report
		m.report = &r
		m.done = true
		content := m.renderContent()
		if m.ready {
			m.vp.SetContent(content)
		} else {
			m.pendingContent = content
		}
		return m, nil // stay open; user presses q to exit

	case spinTickMsg:
		m.spinnerFrame = (m.spinnerFrame + 1) % len(spinnerFrames)
		if !m.done {
			cmds = append(cmds, spinTickCmd())
		}
	}

	// Forward all events to the viewport (handles j/k/↑/↓/PgUp/PgDn/mouse).
	if m.ready {
		var cmd tea.Cmd
		m.vp, cmd = m.vp.Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

// ---------------------------------------------------------------------------
// Content renderer (used by viewport and resize handler)
// ---------------------------------------------------------------------------

// renderContent renders the full scrollable report body as a string.
func (m tuiModel) renderContent() string {
	if m.report == nil {
		return ""
	}
	report := m.report

	width := m.width
	if width < 60 {
		width = 80
	}
	contentWidth := width - 6 // account for box borders + padding
	if contentWidth < 40 {
		contentWidth = 40
	}

	var sb strings.Builder

	// Version + timestamp
	sb.WriteString(styleDetail.Render(fmt.Sprintf("  %s   %s", report.Version, report.GeneratedAt)))
	sb.WriteString("\n\n")

	// Group results by section
	type sectionEntry struct {
		name    string
		results []CheckResult
	}
	var sections []sectionEntry
	sectionIndex := map[string]int{}

	for _, r := range report.Results {
		if idx, ok := sectionIndex[r.Section]; ok {
			sections[idx].results = append(sections[idx].results, r)
		} else {
			sectionIndex[r.Section] = len(sections)
			sections = append(sections, sectionEntry{name: r.Section, results: []CheckResult{r}})
		}
	}

	for _, sec := range sections {
		header := styleHeader.Width(contentWidth).Render(sec.name)

		var rows strings.Builder
		rows.WriteString(header + "\n")

		for _, r := range sec.results {
			sym := renderSymbol(r.Status)
			name := styleName.Render(r.Name)
			rows.WriteString(fmt.Sprintf("%s  %s  %s\n", sym, name, r.Message))
			if r.Detail != "" && flagVerbose {
				rows.WriteString(fmt.Sprintf("       %s\n", styleDetail.Render(r.Detail)))
			}
		}

		boxContent := strings.TrimRight(rows.String(), "\n")
		sb.WriteString(styleBox.Width(contentWidth).Render(boxContent))
		sb.WriteString("\n")
	}

	return sb.String()
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

func (m tuiModel) View() string {
	var sb strings.Builder

	// Fixed header
	sb.WriteString("\n")
	sb.WriteString(styleTitle.Render("  Vexxx Diagnostic Tool"))
	sb.WriteString("\n\n")

	if !m.done || !m.ready {
		// Still loading — show spinner
		spin := styleOK.Render(spinnerFrames[m.spinnerFrame])
		sb.WriteString(fmt.Sprintf("  %s  Running checks\u2026\n", spin))
		return sb.String()
	}

	// Scrollable content
	sb.WriteString(m.vp.View())
	sb.WriteString("\n")

	// Fixed footer
	report := m.report
	var scrollHint string
	if m.vp.TotalLineCount() > m.vp.Height {
		scrollHint = "   " + styleDetail.Render("↑/↓ PgUp/PgDn to scroll")
	}
	okStr := styleSummaryOK.Render(fmt.Sprintf("✓ %d OK", report.Summary.OK))
	warnStr := styleSummaryWarn.Render(fmt.Sprintf("⚠ %d warning(s)", report.Summary.Warns))
	errStr := styleSummaryError.Render(fmt.Sprintf("✗ %d error(s)", report.Summary.Errors))
	sb.WriteString(fmt.Sprintf("  %s   %s   %s%s\n", okStr, warnStr, errStr, scrollHint))
	sb.WriteString(styleDetail.Render("  Press q to exit") + "\n")

	return sb.String()
}

func renderSymbol(s Status) string {
	switch s {
	case StatusOK:
		return styleOK.Render("✓")
	case StatusWarn:
		return styleWarn.Render("⚠")
	default:
		return styleError.Render("✗")
	}
}

// ---------------------------------------------------------------------------
// Entry point called from main.go
// ---------------------------------------------------------------------------

// runTUI launches the bubbletea TUI and blocks until the user quits.
// Returns the completed DiagReport for exit-code logic.
func runTUI(configArg, urlArg, apiKeyArg string) DiagReport {
	m := initialModel(configArg, urlArg, apiKeyArg)
	p := tea.NewProgram(m, tea.WithAltScreen())
	finalModel, err := p.Run()
	if err != nil {
		// Fall back to plain text if TUI fails (e.g. no tty)
		results := runAllChecks("", urlArg, apiKeyArg)
		report := buildReport(results)
		printReport(report)
		return report
	}
	if fm, ok := finalModel.(tuiModel); ok && fm.report != nil {
		return *fm.report
	}
	return DiagReport{}
}
