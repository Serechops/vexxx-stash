// Package tlscert generates and maintains a self-signed local certificate
// authority and leaf certificate so Stash can serve HTTPS on the LAN without
// any external dependency or tunnel. This is what enables WebXR (which requires
// a secure context) to run against a locally-hosted server.
//
// Model: a long-lived root CA (installed once on the client device, e.g. a
// Meta Quest) signs a short-lived leaf certificate that carries the machine's
// LAN IPs/hostnames as SANs. The leaf auto-renews (on expiry or when the LAN IP
// changes) without the user having to re-install anything — only the CA needs
// to be trusted on the headset.
package tlscert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

const (
	caCertFile   = "stash-https-ca.crt"
	caKeyFile    = "stash-https-ca.key"
	leafCertFile = "stash-https.crt"
	leafKeyFile  = "stash-https.key"

	caValidity   = 10 * 365 * 24 * time.Hour // 10 years — install once
	leafValidity = 397 * 24 * time.Hour      // <398d so browsers accept it
	// Renew the leaf a little before it actually expires.
	leafRenewBefore = 24 * time.Hour
)

// Paths bundles the on-disk locations of the generated files.
type Paths struct {
	CACert   string
	CAKey    string
	LeafCert string
	LeafKey  string
}

// PathsIn returns the certificate file paths within the given directory.
func PathsIn(dir string) Paths {
	return Paths{
		CACert:   filepath.Join(dir, caCertFile),
		CAKey:    filepath.Join(dir, caKeyFile),
		LeafCert: filepath.Join(dir, leafCertFile),
		LeafKey:  filepath.Join(dir, leafKeyFile),
	}
}

// EnsureCert returns a server certificate (leaf + CA chain) for HTTPS, creating
// or renewing the CA and leaf in dir as needed. The returned CACertPath is the
// file to install/trust on client devices (e.g. the Quest). The private keys
// are never exposed beyond disk.
func EnsureCert(dir string) (serverCert tls.Certificate, caCertPath string, err error) {
	p := PathsIn(dir)

	caCert, caKey, err := ensureCA(p)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("tlscert: ensuring CA: %w", err)
	}

	leaf, err := ensureLeaf(p, caCert, caKey)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("tlscert: ensuring leaf: %w", err)
	}

	return leaf, p.CACert, nil
}

// ── CA ──────────────────────────────────────────────────────────────────────

func ensureCA(p Paths) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	if cert, key, err := loadCA(p); err == nil && time.Now().Before(cert.NotAfter.Add(-leafRenewBefore)) {
		return cert, key, nil
	}
	return generateCA(p)
}

func loadCA(p Paths) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	certPEM, err := os.ReadFile(p.CACert)
	if err != nil {
		return nil, nil, err
	}
	keyPEM, err := os.ReadFile(p.CAKey)
	if err != nil {
		return nil, nil, err
	}
	cert, err := parseCertPEM(certPEM)
	if err != nil {
		return nil, nil, err
	}
	key, err := parseKeyPEM(keyPEM)
	if err != nil {
		return nil, nil, err
	}
	return cert, key, nil
}

func generateCA(p Paths) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serialNumber(),
		Subject: pkix.Name{
			Organization: []string{"Stash"},
			CommonName:   "Stash Local HTTPS CA",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(caValidity),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	if err := writeCertPEM(p.CACert, der); err != nil {
		return nil, nil, err
	}
	if err := writeKeyPEM(p.CAKey, key); err != nil {
		return nil, nil, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, nil, err
	}
	return cert, key, nil
}

// ── Leaf ──────────────────────────────────────────────────────────────────--

func ensureLeaf(p Paths, caCert *x509.Certificate, caKey *ecdsa.PrivateKey) (tls.Certificate, error) {
	if cert, err := loadLeaf(p, caCert); err == nil {
		return cert, nil
	}
	return generateLeaf(p, caCert, caKey)
}

// loadLeaf loads the leaf, returning an error if it is missing, expired/soon-to-
// expire, no longer chains to the current CA, or no longer covers the current
// LAN IPs — in all of which cases the caller regenerates it.
func loadLeaf(p Paths, caCert *x509.Certificate) (tls.Certificate, error) {
	certPEM, err := os.ReadFile(p.LeafCert)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyPEM, err := os.ReadFile(p.LeafKey)
	if err != nil {
		return tls.Certificate{}, err
	}
	leaf, err := parseCertPEM(certPEM)
	if err != nil {
		return tls.Certificate{}, err
	}

	now := time.Now()
	if now.Before(leaf.NotBefore) || now.After(leaf.NotAfter.Add(-leafRenewBefore)) {
		return tls.Certificate{}, fmt.Errorf("leaf expired or expiring")
	}
	// Must still chain to the current CA.
	roots := x509.NewCertPool()
	roots.AddCert(caCert)
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: roots}); err != nil {
		return tls.Certificate{}, fmt.Errorf("leaf no longer chains to CA: %w", err)
	}
	// Must still cover every current non-loopback IP.
	_, ips := localHosts()
	for _, ip := range ips {
		if ip.IsLoopback() {
			continue
		}
		if !leafHasIP(leaf, ip) {
			return tls.Certificate{}, fmt.Errorf("leaf missing current IP %s", ip)
		}
	}

	keyPair, err := tls.X509KeyPair(append(certPEM, pemForCert(caCert)...), keyPEM)
	if err != nil {
		return tls.Certificate{}, err
	}
	return keyPair, nil
}

func generateLeaf(p Paths, caCert *x509.Certificate, caKey *ecdsa.PrivateKey) (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	dnsNames, ips := localHosts()
	tmpl := &x509.Certificate{
		SerialNumber: serialNumber(),
		Subject: pkix.Name{
			Organization: []string{"Stash"},
			CommonName:   "Stash Local HTTPS",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(leafValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              dnsNames,
		IPAddresses:           ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &key.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, err
	}
	if err := writeCertPEM(p.LeafCert, der); err != nil {
		return tls.Certificate{}, err
	}
	if err := writeKeyPEM(p.LeafKey, key); err != nil {
		return tls.Certificate{}, err
	}

	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM, err := keyToPEM(key)
	if err != nil {
		return tls.Certificate{}, err
	}
	return tls.X509KeyPair(append(leafPEM, pemForCert(caCert)...), keyPEM)
}

// ── helpers ─────────────────────────────────────────────────────────────────

// localHosts collects the DNS names and IPs to put in the leaf's SANs:
// localhost, loopback, the machine hostname (+ ".local"), and every
// non-loopback interface address.
func localHosts() (dnsNames []string, ips []net.IP) {
	dnsNames = []string{"localhost"}
	ips = []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback}

	if host, err := os.Hostname(); err == nil && host != "" {
		dnsNames = append(dnsNames, host)
		dnsNames = append(dnsNames, host+".local")
	}

	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		var ip net.IP
		switch v := a.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			continue
		}
		ips = append(ips, ip)
	}
	return dnsNames, ips
}

func leafHasIP(cert *x509.Certificate, ip net.IP) bool {
	for _, certIP := range cert.IPAddresses {
		if certIP.Equal(ip) {
			return true
		}
	}
	return false
}

func serialNumber() *big.Int {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	n, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return big.NewInt(time.Now().UnixNano())
	}
	return n
}

func writeCertPEM(path string, der []byte) error {
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600)
}

func writeKeyPEM(path string, key *ecdsa.PrivateKey) error {
	b, err := keyToPEM(key)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func keyToPEM(key *ecdsa.PrivateKey) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

func pemForCert(cert *x509.Certificate) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})
}

func parseCertPEM(b []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, fmt.Errorf("no PEM certificate found")
	}
	return x509.ParseCertificate(block.Bytes)
}

func parseKeyPEM(b []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, fmt.Errorf("no PEM key found")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("unexpected key type %T", k)
	}
	return key, nil
}
