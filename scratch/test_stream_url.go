package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	urlStr := "https://nsnetworkmembers.newsensations.com/members/content/upload/iv-misty_CumInside01_640x480/640MP4_12000/misty_cuminside01_640x480.mp4?validfrom=1786544223&validto=1786551423&hash=kKehGrPmtSkE8cIwu2vz2O4NkBw%3D"
	if len(os.Args) > 1 {
		urlStr = os.Args[1]
	}

	client := &http.Client{}

	reqs := []struct {
		name    string
		referer string
		ua      string
	}{
		{"Default", "", ""},
		{"With User-Agent", "", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
		{"With Referer newsensations.com", "https://newsensations.com/", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
		{"With Referer nsnetworkmembers", "https://nsnetworkmembers.newsensations.com/", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
	}

	for _, tc := range reqs {
		req, _ := http.NewRequest("HEAD", urlStr, nil)
		if tc.ua != "" {
			req.Header.Set("User-Agent", tc.ua)
		}
		if tc.referer != "" {
			req.Header.Set("Referer", tc.referer)
		}

		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("[%s] ERROR: %v\n", tc.name, err)
			continue
		}
		resp.Body.Close()
		fmt.Printf("[%s] HTTP %d (Content-Length: %v)\n", tc.name, resp.StatusCode, resp.Header.Get("Content-Length"))
	}
}
