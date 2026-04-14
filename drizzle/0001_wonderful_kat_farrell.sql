CREATE TABLE `despesas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`data` timestamp NOT NULL,
	`descricao` varchar(255) NOT NULL,
	`valor` int NOT NULL,
	`categoria` enum('tecido','insumos','aluguel','outro') NOT NULL DEFAULT 'outro',
	`observacoes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `despesas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pedidos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`cliente` varchar(255) NOT NULL,
	`telefone` varchar(20) NOT NULL,
	`quantidade` int NOT NULL,
	`tipo_servico` varchar(255) NOT NULL,
	`valor` int NOT NULL,
	`descricao` text,
	`observacoes` text,
	`status` enum('pendente','em_producao','concluido','atrasado') NOT NULL DEFAULT 'pendente',
	`data_criacao` timestamp NOT NULL DEFAULT (now()),
	`data_entrega` timestamp NOT NULL,
	`data_conclusao` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pedidos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receitas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`data` timestamp NOT NULL,
	`descricao` varchar(255) NOT NULL,
	`valor` int NOT NULL,
	`categoria` enum('pedido','outro') NOT NULL DEFAULT 'pedido',
	`observacoes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `receitas_id` PRIMARY KEY(`id`)
);
