package tlscert

import (
	"crypto/x509"
	"net"
	"os"
	"testing"
	"time"
)

func TestEnsureCertGeneratesValidChain(t *testing.T) {
	dir := t.TempDir()

	serverCert, caCertPath, err := EnsureCert(dir)
	if err != nil {
		t.Fatalf("EnsureCert: %v", err)
	}

	// Server cert should present the leaf + CA chain.
	if len(serverCert.Certificate) != 2 {
		t.Fatalf("expected 2 certs in chain (leaf + CA), got %d", len(serverCert.Certificate))
	}

	leaf, err := x509.ParseCertificate(serverCert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}

	// Leaf must carry loopback in its SANs (used by localhost access).
	hasLoopback := false
	for _, ip := range leaf.IPAddresses {
		if ip.Equal(net.IPv4(127, 0, 0, 1)) {
			hasLoopback = true
		}
	}
	if !hasLoopback {
		t.Errorf("leaf SANs missing 127.0.0.1: %v", leaf.IPAddresses)
	}
	if !contains(leaf.DNSNames, "localhost") {
		t.Errorf("leaf SANs missing localhost: %v", leaf.DNSNames)
	}

	// Leaf must chain to the on-disk CA.
	caPEM, err := os.ReadFile(caCertPath)
	if err != nil {
		t.Fatalf("read CA: %v", err)
	}
	ca, err := parseCertPEM(caPEM)
	if err != nil {
		t.Fatalf("parse CA: %v", err)
	}
	if !ca.IsCA {
		t.Error("CA cert is not marked IsCA")
	}
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:     roots,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}); err != nil {
		t.Errorf("leaf does not verify against CA: %v", err)
	}

	// Leaf validity should be under the browser 398-day cap.
	if d := leaf.NotAfter.Sub(leaf.NotBefore); d > 398*24*time.Hour {
		t.Errorf("leaf validity %v exceeds 398 days", d)
	}
}

func TestEnsureCertReusesExisting(t *testing.T) {
	dir := t.TempDir()

	first, _, err := EnsureCert(dir)
	if err != nil {
		t.Fatalf("first EnsureCert: %v", err)
	}
	second, _, err := EnsureCert(dir)
	if err != nil {
		t.Fatalf("second EnsureCert: %v", err)
	}

	// A valid leaf should be reused, not regenerated.
	l1, _ := x509.ParseCertificate(first.Certificate[0])
	l2, _ := x509.ParseCertificate(second.Certificate[0])
	if l1.SerialNumber.Cmp(l2.SerialNumber) != 0 {
		t.Error("leaf was regenerated on second call; expected reuse")
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
