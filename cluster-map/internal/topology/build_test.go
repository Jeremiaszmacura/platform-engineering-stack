package topology

import (
	"reflect"
	"slices"
	"testing"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

const gatewayNamespace = "envoy-gateway-system"

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
	proxy := pod(gatewayNamespace, "proxy", "ReplicaSet", "10.0.0.5", corev1.PodSpec{NodeName: "worker"})
	proxy.Labels = map[string]string{"app.kubernetes.io/name": "envoy", gatewayv1.GatewayNameLabelKey: "gw"}
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
	return []*corev1.Pod{proxy, api, db, prometheus, apiserver}
}

// testGateway admits routes from namespaces labelled access=true, like platform/gateway/gateway.yaml.
func testGateway() *gatewayv1.Gateway {
	from := gatewayv1.NamespacesFromSelector
	listener := gatewayv1.Listener{
		Name: "http", Protocol: gatewayv1.HTTPProtocolType, Port: 80, Hostname: new(gatewayv1.Hostname("*.localhost")),
		AllowedRoutes: &gatewayv1.AllowedRoutes{Namespaces: &gatewayv1.RouteNamespaces{
			From: &from, Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"access": "true"}},
		}},
	}
	return &gatewayv1.Gateway{
		ObjectMeta: metav1.ObjectMeta{Namespace: gatewayNamespace, Name: "gw"},
		Spec:       gatewayv1.GatewaySpec{GatewayClassName: "envoy-gateway", Listeners: []gatewayv1.Listener{listener}},
		Status: gatewayv1.GatewayStatus{
			Addresses:  []gatewayv1.GatewayStatusAddress{{Value: "172.18.0.3"}},
			Conditions: []metav1.Condition{{Type: "Programmed", Status: metav1.ConditionTrue}},
			Listeners:  []gatewayv1.ListenerStatus{{Name: "http", AttachedRoutes: 1}},
		},
	}
}

func condition(kind string, status metav1.ConditionStatus, reason string) metav1.Condition {
	return metav1.Condition{Type: kind, Status: status, Reason: reason}
}

// httpRoute sends host to service:port through the test Gateway, with the status its controller reported.
func httpRoute(namespace, host, service string, port int32, status metav1.Condition, filters ...gatewayv1.HTTPRouteFilter) *gatewayv1.HTTPRoute {
	parent := gatewayv1.ParentReference{Name: "gw", Namespace: new(gatewayv1.Namespace(gatewayNamespace))}
	backend := gatewayv1.BackendObjectReference{Name: gatewayv1.ObjectName(service), Port: new(port)}
	return &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: service + "-route"},
		Spec: gatewayv1.HTTPRouteSpec{
			CommonRouteSpec: gatewayv1.CommonRouteSpec{ParentRefs: []gatewayv1.ParentReference{parent}},
			Hostnames:       []gatewayv1.Hostname{gatewayv1.Hostname(host)},
			Rules: []gatewayv1.HTTPRouteRule{{
				Filters:     filters,
				BackendRefs: []gatewayv1.HTTPBackendRef{{BackendRef: gatewayv1.BackendRef{BackendObjectReference: backend}}},
			}},
		},
		Status: gatewayv1.HTTPRouteStatus{RouteStatus: gatewayv1.RouteStatus{
			Parents: []gatewayv1.RouteParentStatus{{ParentRef: parent, Conditions: []metav1.Condition{status}}},
		}},
	}
}

// testRoutes: the Gateway accepts api's route (with CORS) and rejects db's, whose namespace isn't labelled.
func testRoutes() []*gatewayv1.HTTPRoute {
	cors := gatewayv1.HTTPRouteFilter{Type: gatewayv1.HTTPRouteFilterCORS}
	return []*gatewayv1.HTTPRoute{
		httpRoute("apps", "api.localhost", "api-service", 8080, condition("Accepted", metav1.ConditionTrue, "Accepted"), cors),
		httpRoute("data", "db.localhost", "db-service", 5432, condition("Accepted", metav1.ConditionFalse, "NotAllowedByListeners")),
	}
}

func proxyServiceFor(gateway string) *corev1.Service {
	s := service(gatewayNamespace, gateway+"-proxy", "envoy", 80, nil)
	s.Labels = map[string]string{gatewayv1.GatewayNameLabelKey: gateway}
	s.Spec.Type = corev1.ServiceTypeNodePort
	s.Spec.Ports[0].TargetPort = intstr.FromInt32(10080)
	s.Spec.Ports[0].NodePort = 30080
	return s
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
			ObjectMeta: metav1.ObjectMeta{Name: "cp", Labels: map[string]string{"node-role.kubernetes.io/control-plane": ""}},
			Status:     corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "172.18.0.3"}}},
		}},
		Pods: testPods(),
		Services: []*corev1.Service{
			service("apps", "api-service", "api", 8080, map[string]string{"prometheus.io/scrape": "true", "prometheus.io/job": "api"}),
			service("data", "db-service", "db", 5432, nil),
			proxyServiceFor("gw"),
		},
		Gateways:         []*gatewayv1.Gateway{testGateway()},
		HTTPRoutes:       testRoutes(),
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
		{"envoy-gateway-system/proxy", "apps/api", "api.localhost", "gateway"},
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

func TestBuildGateways(t *testing.T) {
	want := []Gateway{{
		ID: "envoy-gateway-system/gw", Name: "gw", Namespace: gatewayNamespace, Class: "envoy-gateway", Programmed: true,
		Addresses: []string{"172.18.0.3"},
		Listeners: []Listener{{
			Name: "http", Protocol: "HTTP", Port: 80, Hostname: "*.localhost",
			AllowedRoutes: "namespaces labelled access=true", AttachedRoutes: 1,
		}},
		ProxyPods:    []string{"envoy-gateway-system/proxy"},
		ProxyService: "envoy-gateway-system/gw-proxy",
	}}
	if got := Build(testSnapshot()).Gateways; !reflect.DeepEqual(got, want) {
		t.Errorf("gateways:\n got %+v\nwant %+v", got, want)
	}
}

func TestBuildRoutes(t *testing.T) {
	want := []Route{
		{
			ID: "apps/api-service-route", Name: "api-service-route", Namespace: "apps", Gateways: []string{"envoy-gateway-system/gw"},
			Hostnames: []string{"api.localhost"}, Backends: []Backend{{Service: "apps/api-service", Port: 8080}},
			Filters: []string{"CORS"}, Accepted: true, Status: "Accepted",
		},
		{
			ID: "data/db-service-route", Name: "db-service-route", Namespace: "data", Gateways: []string{"envoy-gateway-system/gw"},
			Hostnames: []string{"db.localhost"}, Backends: []Backend{{Service: "data/db-service", Port: 5432}},
			Filters: []string{}, Status: "not accepted: NotAllowedByListeners",
		},
	}
	if got := Build(testSnapshot()).Routes; !reflect.DeepEqual(got, want) {
		t.Errorf("routes:\n got %+v\nwant %+v", got, want)
	}
}

func TestBuildServicesShowAcceptedRoutesAndNodePorts(t *testing.T) {
	byID := map[string]Service{}
	for _, s := range Build(testSnapshot()).Services {
		byID[s.ID] = s
	}
	if api := byID["apps/api-service"]; !slices.Equal(api.Hostnames, []string{"api.localhost"}) || !api.CORS {
		t.Errorf("api-service: hostnames %v, cors %v; want the accepted route's host with CORS", api.Hostnames, api.CORS)
	}
	if db := byID["data/db-service"]; len(db.Hostnames) != 0 || db.CORS {
		t.Errorf("db-service: hostnames %v, cors %v; a rejected route must not count", db.Hostnames, db.CORS)
	}
	proxy := byID["envoy-gateway-system/gw-proxy"]
	if !slices.Equal(proxy.Ports, []string{"80 → 10080/TCP (nodePort 30080)"}) || !slices.Equal(proxy.NodePorts, []string{"30080"}) {
		t.Errorf("proxy ports = %v, node ports = %v", proxy.Ports, proxy.NodePorts)
	}
}

func TestRouteStatus(t *testing.T) {
	parent := func(conditions ...metav1.Condition) []gatewayv1.RouteParentStatus {
		return []gatewayv1.RouteParentStatus{{Conditions: conditions}}
	}
	accepted := condition("Accepted", metav1.ConditionTrue, "Accepted")
	tests := []struct {
		name         string
		parents      []gatewayv1.RouteParentStatus
		wantAccepted bool
		wantStatus   string
	}{
		{"no controller yet", nil, false, "no status yet: no Gateway controller has processed it"},
		{"accepted", parent(accepted), true, "Accepted"},
		{"rejected", parent(condition("Accepted", metav1.ConditionFalse, "NotAllowedByListeners")), false, "not accepted: NotAllowedByListeners"},
		{"missing backend", parent(accepted, condition("ResolvedRefs", metav1.ConditionFalse, "BackendNotFound")), true,
			"accepted, but a backend is unresolved: BackendNotFound"},
	}
	for _, tt := range tests {
		if accepted, status := routeStatus(tt.parents); accepted != tt.wantAccepted || status != tt.wantStatus {
			t.Errorf("%s: routeStatus = %v, %q; want %v, %q", tt.name, accepted, status, tt.wantAccepted, tt.wantStatus)
		}
	}
}

func TestAllowedNamespaces(t *testing.T) {
	from := func(f gatewayv1.FromNamespaces) *gatewayv1.AllowedRoutes {
		return &gatewayv1.AllowedRoutes{Namespaces: &gatewayv1.RouteNamespaces{From: &f}}
	}
	tests := []struct {
		allowed *gatewayv1.AllowedRoutes
		want    string
	}{
		{nil, "the Gateway's namespace"},
		{from(gatewayv1.NamespacesFromSame), "the Gateway's namespace"},
		{from(gatewayv1.NamespacesFromAll), "all namespaces"},
		{from(gatewayv1.NamespacesFromNone), "no namespace"},
	}
	for _, tt := range tests {
		if got := allowedNamespaces(tt.allowed); got != tt.want {
			t.Errorf("allowedNamespaces(%+v) = %q, want %q", tt.allowed, got, tt.want)
		}
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
	if m.Pods == nil || m.Links == nil || m.Config == nil || m.NetworkPolicies == nil || m.Gateways == nil || m.Routes == nil {
		t.Errorf("empty snapshot produced nil lists: %+v", m)
	}
}
