## General

- At the end of each plan, give me a list of unresolved questions to answer, if any. Make questions extremely concise.

## Programming rules

- Write code following YAGNI principles. Only add code that is necessary for the current requirements. Avoid adding features or functionality that may be needed in the future but are not currently required. Focus on delivering a simple and functional solution that meets the immediate needs of the project.

- Code should be clean, well-structured, and easy to understand. Use meaningful variable and function names, and include comments where necessary to explain complex logic or decisions. Avoid unnecessary complexity and strive for simplicity in your code design.

- Functions should be small and focused on a single task. Each function should have a clear purpose.

- Avoid code duplication by creating reusable functions or modules. If you find yourself writing the same code multiple times, consider refactoring it into a separate function or module that can be called from different parts of the codebase.

- Write code that is easy to test. This includes writing functions that are pure (i.e., they do not have side effects) and can be easily mocked or stubbed in tests. Avoid writing code that is tightly coupled to specific implementations or external dependencies, as this can make testing more difficult.

- Catch errors immediately and handle exceptions properly.

- Add docstrings to all functions and classes to explain their purpose, parameters, and return values. Docstrings should be clear and concise.

- Implementation should be data oriented, meaning that the code should be designed to work with data structures and objects (Object-Oriented Programming).

## Project specific rules

- `recreate-cluster` script is the main entry point for deploying the Kubernetes cluster. It should be designed to be idempotent, meaning that running it multiple times should not cause any issues or unintended consequences. The script should handle all necessary steps for creating and configuring the cluster, including deploying the various components and applications.

- Each directory in project contain different component of the cluster.

- stock-app is a backend application that provides stock data to the frontend application. It should be designed to handle requests from the frontend application and return the appropriate stock data in a structured format.

- go-app is a backend application that provides a simple API endpoints for cluster testing purposes.

- Grafana dashboards are persisted in `monitoring/grafana/ansible/dashboards` directory. Each dashboard should be defined in a separate JSON file.

- stock-ui application is a frontend application that provides a simple interface for interacting with stock-app application. This application is aimed to present and visualize the stock data provided by the stock-app application.

- frontend-app application is designed to provide a simple interface for testing Go application. It should allow users to trigger requests to the backend applications and display the results. Those results are then monitored with Prometheus and visualized in Grafana.

- Documentation is built using mkdocs in `documentation` directory and should be clear and concise. Documentation should be up-to-date with the current state of the project. Each project should have own documentation page explaining its purpose. Documentation should include instructions for deploying the cluster, and explaining workflow of the cluster and its components.