package com.app.backend.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ColaConfig {

    public static final String COLA_EJECUCION = "ejecucion.cola";
    public static final String EXCHANGE        = "ejecucion.exchange";
    public static final String ROUTING_KEY     = "ejecucion.key";

    @Bean
    public Queue colaEjecucion() {
        // durable=true — la cola sobrevive reinicios del broker
        return new Queue(COLA_EJECUCION, true);
    }

    @Bean
    public DirectExchange exchange() {
        return new DirectExchange(EXCHANGE);
    }

    @Bean
    public Binding binding(Queue colaEjecucion, DirectExchange exchange) {
        return BindingBuilder.bind(colaEjecucion).to(exchange).with(ROUTING_KEY);
    }

    @Bean
    public Jackson2JsonMessageConverter converter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory cf) {
        RabbitTemplate template = new RabbitTemplate(cf);
        template.setMessageConverter(converter());
        return template;
    }
}