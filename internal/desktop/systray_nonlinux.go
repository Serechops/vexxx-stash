//go:build (windows || darwin) && cgo

package desktop

import (
	"fmt"
	"runtime"
	"strings"
	"time"

	"github.com/kermieisinthehouse/systray"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
)

// MUST be run on the main goroutine or will have no effect on macOS
func startSystray(exit chan int, faviconProvider FaviconProvider) {
	// Shows a small notification to inform that Stash will no longer show a terminal window,
	// and instead will be available in the tray. Will only show the first time a pre-desktop integration
	// system is started from a non-terminal method, e.g. double-clicking an icon.
	c := config.GetInstance()
	if c.GetShowOneTimeMovedNotification() {
		// Use platform-appropriate terminology
		location := "tray"
		if runtime.GOOS == "darwin" {
			location = "menu bar"
		}
		SendNotification("Vexxx has moved!", "Vexxx now runs in your "+location+", instead of a terminal window.")
		c.SetBool(config.ShowOneTimeMovedNotification, false)
		if err := c.Write(); err != nil {
			logger.Errorf("Error while writing configuration file: %v", err)
		}
	}

	// Listen for changes to rerender systray
	// TODO: This is disabled for now. The systray package does not clean up all of its resources when Quit() is called.
	// TODO: This results in this only working once, or changes being ignored. Our fork of systray fixes a crash(!) on macOS here.
	// go func() {
	// 	for {
	// 		<-config.GetInstance().GetConfigUpdatesChannel()
	// 		systray.Quit()
	// 	}
	// }()

	// "intercept" an exit code to quit the systray, allowing the call to systray.Run() below to return.
	go func() {
		exitCode := <-exit
		systray.Quit()
		exit <- exitCode
	}()

	systray.Run(func() {
		systrayInitialize(exit, faviconProvider)
	}, nil)
}

func systrayInitialize(exit chan<- int, faviconProvider FaviconProvider) {
	favicon := faviconProvider.GetFavicon()
	systray.SetTemplateIcon(favicon, favicon)
	c := config.GetInstance()
	systray.SetTooltip(fmt.Sprintf("🟢 Vexxx is Running on port %d.", c.GetPort()))

	logger.Infof("[Systray] Initializing systray menu. ConfigFile: %s, IsNewSystem: %v", c.GetConfigFile(), c.IsNewSystem())

	openStashButton := systray.AddMenuItem("Open Vexxx", "Open a browser window to Vexxx")
	var menuItems []string
	systray.AddSeparator()

	quitStashButton := systray.AddMenuItem("Quit Vexxx Server", "Quits the Vexxx server")

	addMenuItems := func() {
		menuItems = c.GetMenuItems()
		logger.Infof("[Systray] Found %d menu items to add: %v", len(menuItems), menuItems)
		for _, item := range menuItems {
			c := cases.Title(language.Und)
			titleCaseItem := c.String(strings.ToLower(strings.ReplaceAll(item, "_", " ")))
			logger.Infof("[Systray] Adding menu item: %s", titleCaseItem)
			curr := systray.AddMenuItem(titleCaseItem, "Open to "+titleCaseItem)
			go func(item string) {
				for {
					<-curr.ClickedCh
					urlItem := strings.ReplaceAll(item, "_", "-")
					if urlItem == "markers" {
						urlItem = "scenes/markers"
					}
					openURLInBrowser(urlItem)
				}
			}(item)
		}
		systray.AddSeparator()
	}

	if !c.IsNewSystem() {
		addMenuItems()
	} else {
		logger.Warn("[Systray] Skipping menu items because system is in new/setup state. Starting setup completion listener.")
		go func() {
			for {
				time.Sleep(1 * time.Second)
				if !c.IsNewSystem() {
					break
				}
			}
			logger.Info("[Systray] Setup completed! Dynamically adding menu items to systray.")

			// 1. Hide the old quit button
			quitStashButton.Hide()

			// 2. Add menu items and separator
			addMenuItems()

			// 3. Create a new quit button at the bottom
			newQuitButton := systray.AddMenuItem("Quit Vexxx Server", "Quits the Vexxx server")
			go func() {
				for {
					<-newQuitButton.ClickedCh
					exit <- 0
				}
			}()
		}()
	}

	go func() {
		for {
			select {
			case <-openStashButton.ClickedCh:
				openURLInBrowser("")
			case <-quitStashButton.ClickedCh:
				exit <- 0
				return
			}
		}
	}()
}
