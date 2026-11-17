package main

import (
	"slices"
	"testing"

	"documentation/internal/topology"
)

func TestParseReferences(t *testing.T) {
	got := parseReferences(" grafana=http://prometheus-service:9090, broken, =x ,")
	want := []topology.Reference{{App: "grafana", Value: "http://prometheus-service:9090"}}
	if !slices.Equal(got, want) {
		t.Errorf("parseReferences = %v, want %v", got, want)
	}
}

func TestPrometheusURL(t *testing.T) {
	tests := []struct {
		value   string
		want    string
		wantErr bool
	}{
		{"", "http://prometheus.localhost", false},
		{"http://prometheus-service.monitoring:9090", "http://prometheus-service.monitoring:9090", false},
		{"prometheus-service:9090", "", true},
		{"http://%zz", "", true},
	}
	for _, tt := range tests {
		t.Setenv("PROMETHEUS_URL", tt.value)
		got, err := prometheusURL()
		if (err != nil) != tt.wantErr || (err == nil && got.String() != tt.want) {
			t.Errorf("prometheusURL(%q) = %v, %v; want %q, error %v", tt.value, got, err, tt.want, tt.wantErr)
		}
	}
}
