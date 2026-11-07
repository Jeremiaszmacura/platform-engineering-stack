package topology

import (
	"slices"
	"testing"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func pod(namespace, name, owner, ip string, spec corev1.PodSpec) *corev1.Pod {
	p := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name, Labels: map[string]string{"app": name}},
		Spec:       spec,
		Status:     corev1.PodStatus{Phase: corev1.PodRunning, PodIP: ip},
	}
	if owner != "" {
		p.OwnerReferences = []metav1.OwnerReference{{Kind: owner}}
	}
	return p
}

func service(namespace, name, app string, port int32, annotations map[string]string) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name, Annotations: annotations},
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: map[string]string{"app": app},
			Ports:    []corev1.ServicePort{{Port: port, TargetPort: intstr.FromInt32(port), Protocol: corev1.ProtocolTCP}},
		},
	}
}

func testPods() []*corev1.Pod {
	controller := pod("ingress-nginx", "controller", "ReplicaSet", "10.0.0.5", corev1.PodSpec{NodeName: "worker"})
	controller.Labels = map[string]string{"app.kubernetes.io/name": "ingress-nginx"}
	password := &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{
		LocalObjectReference: corev1.LocalObjectReference{Name: "db-secret"}, Key: "password"}}
	api := pod("apps", "api", "ReplicaSet", "10.0.0.6", corev1.PodSpec{
		ServiceAccountName: "api",
		Containers: []corev1.Container{{Env: []corev1.EnvVar{
			{Name: "DB_HOST", Value: "db-service.data"},
			{Name: "DB_PASSWORD", ValueFrom: password},
		}}},
	})
	claim := &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data-db-0"}
	db := pod("data", "db", "StatefulSet", "10.0.0.7", corev1.PodSpec{
		Volumes: []corev1.Volume{{Name: "data", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: claim}}},
	})
	prometheus := pod("monitoring", "prometheus", "ReplicaSet", "10.0.0.8", corev1.PodSpec{
		ServiceAccountName: "prometheus",
		Volumes:            []corev1.Volume{{Name: "kube-api-access-x1"}},
	})
	apiserver := pod("kube-system", "kube-apiserver-cp", "Node", "172.18.0.3", corev1.PodSpec{
		HostNetwork: true,
		Containers:  []corev1.Container{{Command: []string{"kube-apiserver", "--service-cluster-ip-range=10.96.0.0/16"}}},
	})
	apiserver.Labels = map[string]string{"component": "kube-apiserver"}
	return []*corev1.Pod{controller, api, db, prometheus, apiserver}
}

func testIngresses() []*networkingv1.Ingress {
	path := networkingv1.HTTPIngressPath{
		Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "api-service"}},
	}
	rule := networkingv1.IngressRule{
		Host:             "api.localhost",
		IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{Paths: []networkingv1.HTTPIngressPath{path}}},
	}
	return []*networkingv1.Ingress{{
		ObjectMeta: metav1.ObjectMeta{Namespace: "apps", Name: "api-ingress"},
		Spec:       networkingv1.IngressSpec{Rules: []networkingv1.IngressRule{rule}},
	}}
}

func addRBAC(s *Snapshot) {
	s.ServiceAccounts = []*corev1.ServiceAccount{
		{ObjectMeta: metav1.ObjectMeta{Namespace: "apps", Name: "api"}, AutomountServiceAccountToken: new(bool)},
		{ObjectMeta: metav1.ObjectMeta{Namespace: "monitoring", Name: "prometheus"}},
	}
	s.ClusterRoles = []*rbacv1.ClusterRole{{
		ObjectMeta: metav1.ObjectMeta{Name: "reader"},
		Rules:      []rbacv1.PolicyRule{{Verbs: []string{"list", "watch"}, Resources: []string{"pods"}}},
	}}
	s.ClusterRoleBindings = []*rbacv1.ClusterRoleBinding{{
		RoleRef:  rbacv1.RoleRef{Kind: "ClusterRole", Name: "reader"},
		Subjects: []rbacv1.Subject{{Kind: rbacv1.ServiceAccountKind, Namespace: "monitoring", Name: "prometheus"}},
	}}
}

func addStorage(s *Snapshot) {
	storageClass := "standard"
	s.Claims = []*corev1.PersistentVolumeClaim{{
		ObjectMeta: metav1.ObjectMeta{Namespace: "data", Name: "data-db-0"},
		Spec:       corev1.PersistentVolumeClaimSpec{VolumeName: "pv-1", StorageClassName: &storageClass},
		Status:     corev1.PersistentVolumeClaimStatus{Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("2Gi")}},
	}}
	terms := []corev1.NodeSelectorTerm{{MatchExpressions: []corev1.NodeSelectorRequirement{{Values: []string{"worker2"}}}}}
	s.Volumes = []*corev1.PersistentVolume{{
		ObjectMeta: metav1.ObjectMeta{Name: "pv-1"},
		Spec: corev1.PersistentVolumeSpec{
			PersistentVolumeSource: corev1.PersistentVolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/var/local/pv-1"}},
			NodeAffinity:           &corev1.VolumeNodeAffinity{Required: &corev1.NodeSelector{NodeSelectorTerms: terms}},
		},
	}}
}

func testSnapshot() Snapshot {
	s := Snapshot{
		Nodes: []*corev1.Node{{
			ObjectMeta: metav1.ObjectMeta{Name: "cp", Labels: map[string]string{"ingress-ready": "true", "node-role.kubernetes.io/control-plane": ""}},
			Status:     corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "172.18.0.3"}}},
		}},
		Pods: testPods(),
		Services: []*corev1.Service{
			service("apps", "api-service", "api", 8080, map[string]string{"prometheus.io/scrape": "true", "prometheus.io/job": "api"}),
			service("data", "db-service", "db", 5432, nil),
		},
		Ingresses:        testIngresses(),
		ProxyConfig:      "mode: iptables\nclusterCIDR: 10.244.0.0/16\n",
		PrometheusConfig: "namespaces:\n  names: [apps, monitoring]\n",
	}
	addRBAC(&s)
	addStorage(&s)
	return s
}

func TestBuildLinks(t *testing.T) {
	m := Build(testSnapshot())
	want := []Link{
		{"ingress-nginx/controller", "apps/api", "api.localhost", "ingress"},
		{"apps/api", "data/db", "db-service.data:5432", "call"},
		{"monitoring/prometheus", "apps/api", "scrape 10.0.0.6:8080/metrics (job api)", "scrape"},
		{"monitoring/prometheus", "kube-system/kube-apiserver-cp", "Kubernetes API (ServiceAccount token)", "api"},
	}
	if !slices.Equal(m.Links, want) {
		t.Errorf("links:\n got %v\nwant %v", m.Links, want)
	}
}

func TestBuildRanges(t *testing.T) {
	if got := Build(testSnapshot()).Ranges; got.Pods != "10.244.0.0/16" || got.Services != "10.96.0.0/16" {
		t.Errorf("ranges = %+v", got)
	}
}

func TestBuildServiceAccounts(t *testing.T) {
	want := []ServiceAccount{
		{Name: "api", Namespace: "apps", Automount: "false", UsedBy: []string{"api"}, Permissions: []string{}},
		{Name: "prometheus", Namespace: "monitoring", Automount: "not set (true)", UsedBy: []string{"prometheus"},
			TokenMounted: true, Permissions: []string{"ClusterRole reader (cluster-wide): list,watch pods"}},
	}
	if got := Build(testSnapshot()).ServiceAccounts; !slices.EqualFunc(got, want, equalAccount) {
		t.Errorf("service accounts:\n got %+v\nwant %+v", got, want)
	}
}

func TestBuildConfigAndVolumes(t *testing.T) {
	m := Build(testSnapshot())
	wantConfig := ConfigUse{Kind: "Secret", Name: "db-secret", Namespace: "apps", Keys: []string{"password"}, UsedBy: []string{"api"}}
	if len(m.Config) != 1 || !equalConfig(m.Config[0], wantConfig) {
		t.Errorf("config = %+v", m.Config)
	}
	v := m.Volumes
	if len(v) != 1 || v[0].Node != "worker2" || v[0].Capacity != "2Gi" || !slices.Equal(v[0].Pods, []string{"db"}) {
		t.Errorf("volumes = %+v", v)
	}
}

func TestBuildIngressPlacement(t *testing.T) {
	got := Build(testSnapshot()).Ingress
	if got.Pinned || !slices.Equal(got.RunningOn, []string{"worker"}) || !slices.Equal(got.IngressReadyNodes, []string{"cp"}) {
		t.Errorf("ingress = %+v", got)
	}
}

func equalConfig(a, b ConfigUse) bool {
	return a.Kind == b.Kind && a.Name == b.Name && a.Namespace == b.Namespace &&
		slices.Equal(a.Keys, b.Keys) && slices.Equal(a.UsedBy, b.UsedBy)
}

func equalAccount(a, b ServiceAccount) bool {
	return a.Name == b.Name && a.Namespace == b.Namespace && a.Automount == b.Automount && a.TokenMounted == b.TokenMounted &&
		slices.Equal(a.UsedBy, b.UsedBy) && slices.Equal(a.Permissions, b.Permissions)
}

func TestResolveService(t *testing.T) {
	services := map[string]Service{
		"apps/db":             {Name: "db", Ports: []string{"5432 → 5432/TCP"}, Pods: []string{"apps/db-0"}},
		"vault/vault-service": {Name: "vault-service", Ports: []string{"8200 → 8200/TCP"}},
	}
	tests := []struct {
		value, namespace, wantLabel string
		wantOK                      bool
	}{
		{"db", "apps", "db:5432", true},
		{"db", "monitoring", "", false},
		{"http://vault-service.vault:8200", "apps", "vault-service.vault:8200", true},
		{"vault-service.vault.svc.cluster.local", "apps", "vault-service.vault.svc.cluster.local:8200", true},
		{"https://query1.finance.yahoo.com", "apps", "", false},
		{"/home/app", "apps", "", false},
		{"host:notaport", "apps", "", false},
	}
	for _, tt := range tests {
		_, label, ok := resolveService(tt.value, tt.namespace, services)
		if ok != tt.wantOK || label != tt.wantLabel {
			t.Errorf("resolveService(%q, %q) = %q, %v; want %q, %v", tt.value, tt.namespace, label, ok, tt.wantLabel, tt.wantOK)
		}
	}
}

func TestSDNamespaces(t *testing.T) {
	if got := sdNamespaces("names: [apps, monitoring]"); !slices.Equal(got, []string{"apps", "monitoring"}) {
		t.Errorf("sdNamespaces = %v", got)
	}
	if got := sdNamespaces("role: endpoints"); got != nil {
		t.Errorf("sdNamespaces without a list = %v, want nil (all namespaces)", got)
	}
}

func TestBuildEmptySnapshotHasNoNilLists(t *testing.T) {
	m := Build(Snapshot{})
	if m.Pods == nil || m.Links == nil || m.Config == nil || m.NetworkPolicies == nil || m.Ingress.RunningOn == nil {
		t.Errorf("empty snapshot produced nil lists: %+v", m)
	}
}
